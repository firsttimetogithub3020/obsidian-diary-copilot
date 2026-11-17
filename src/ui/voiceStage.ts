import { Platform, Notice } from "obsidian";
import type { GeminiClient } from "../llm/gemini";
import type { EnglishLevel, DiaryTone } from "../types";
import { buildVoiceRefineSystemPrompt, buildVoiceRefineUserPrompt } from "../llm/prompts";
import { parseVoiceRefineResponse, VoiceRefineResult } from "../engine/parser";
import { speakSentence, stopAudio } from "../services/tts";
import { globalSpeechRecognizer, evaluateOralMatch } from "../services/speech";

export interface VoiceStageCallbacks {
  onInsertSpokenDraft?: (spokenText: string) => Promise<{ from: number; to: number; rawInserted: string }>;
  onAppendSentence: (
    sentence: string,
    draftInfo?: { from: number; to: number; sourceText: string; rawInserted: string },
    kind?: "continue" | "oral"
  ) => Promise<void>;
  getEditorSelection?: () => { text: string; from: number; to: number } | null;
  onLocateDocText?: (text: string) => { from: number; to: number } | null;
  onCardRenderChange?: () => void;
  onTidyUp: () => void;
  onFullTextShadowing: () => void;
  onSwitchToClassic: () => void;
  getEnglishLevel: () => EnglishLevel;
  getTone: () => DiaryTone;
  getDiaryContext: () => string;
}

export class VoiceStage {
  private containerEl: HTMLElement;
  private llm: GeminiClient;
  private callbacks: VoiceStageCallbacks;

  private activeTab: "free" | "interview" = "free";
  private isListening = false;
  private isLoading = false;
  private speechLang: "zh-TW" | "en-US" = "zh-TW";
  private currentTranscript = "";
  private currentRefineResult: VoiceRefineResult | null = null;
  private currentFollowUpQ: { en: string; zh?: string } | null = null;
  private adoptedCount = 0;

  // Active spoken draft tracking for replacement
  private currentDraftInfo: { from: number; to: number; sourceText: string; rawInserted: string } | null = null;

  // Oral practice state within voice stage
  private practicingCardText: string | null = null;

  private micHeroBtnEl: HTMLElement | null = null;
  private micIconEl: HTMLElement | null = null;
  private micLabelEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, llm: GeminiClient, callbacks: VoiceStageCallbacks) {
    this.containerEl = containerEl;
    this.llm = llm;
    this.callbacks = callbacks;
  }

  public hasCards(): boolean {
    return !!this.currentRefineResult;
  }

  render() {
    this.containerEl.empty();
    const stageEl = this.containerEl.createDiv({ cls: "diary-copilot-voice-stage" });

    // 1. Stage Top Nav: Sub-header with Tab Selector
    const navBar = stageEl.createDiv({ cls: "diary-copilot-voice-nav" });

    const tabGroup = navBar.createDiv({ cls: "diary-copilot-voice-tab-group" });
    const freeTabBtn = tabGroup.createEl("button", {
      cls: `diary-copilot-voice-tab-btn ${this.activeTab === "free" ? "is-active" : ""}`,
      text: "💬 隨心說 (中英隨想)",
    });
    freeTabBtn.addEventListener("click", () => {
      this.activeTab = "free";
      this.render();
    });

    const interviewTabBtn = tabGroup.createEl("button", {
      cls: `diary-copilot-voice-tab-btn ${this.activeTab === "interview" ? "is-active" : ""}`,
      text: "❓ AI 訪談 (問答對話)",
    });
    interviewTabBtn.addEventListener("click", () => {
      this.activeTab = "interview";
      this.render();
    });

    // 2. Main Stage Content Area
    const mainArea = stageEl.createDiv({ cls: "diary-copilot-voice-main-area" });

    if (this.activeTab === "interview") {
      this.renderInterviewView(mainArea);
    } else {
      this.renderFreeSpeechView(mainArea);
    }

    // 3. Bottom Global Action Bar: Tidy Up & Full-Text Shadowing
    const bottomBar = stageEl.createDiv({ cls: "diary-copilot-voice-bottom-bar" });
    const tidyBtn = bottomBar.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-voice-tidy-btn",
      text: "✨ 整理今日日記 ➔ 全篇影子跟讀",
      attr: { title: "將今日口說與筆記內容整理成精緻雙語日記並開啟全文跟讀" },
    });
    tidyBtn.addEventListener("click", () => {
      this.callbacks.onTidyUp();
    });
  }

  // --- PILLAR A: 隨心開口說 (Free Speech to 3 Idiomatic Cards) ---
  private renderFreeSpeechView(parentEl: HTMLElement) {
    const cardSection = parentEl.createDiv({ cls: "diary-copilot-voice-speech-section" });

    // Header prompt
    const promptText = cardSection.createDiv({ cls: "diary-copilot-voice-prompt-title" });
    promptText.setText("🎙️ 拿起手機，隨意說一句想記錄的心情或事情（可講中文、英文或中英混雜）：");

    // Microphone Hero Button & Live Input
    this.renderMicHeroComponent(cardSection, (spokenText, existingRange) => {
      this.processSpokenThought(spokenText, existingRange);
    });

    // AI Refined 3 Cards Display
    if (this.isLoading) {
      const loader = cardSection.createDiv({ cls: "diary-copilot-voice-loading-box" });
      loader.createSpan({ cls: "loading-spinner" });
      loader.createSpan({ text: "✨ AI 正在提煉 3 種地道母語風格表達..." });
    } else if (this.currentRefineResult) {
      this.renderRefineCards(cardSection, this.currentRefineResult);
    }
  }

  // --- PILLAR B: AI 訪談引導 (Guided Question QA) ---
  private renderInterviewView(parentEl: HTMLElement) {
    const interviewSection = parentEl.createDiv({ cls: "diary-copilot-voice-interview-section" });

    const qCard = interviewSection.createDiv({ cls: "diary-copilot-voice-interview-qcard" });
    const qHeader = qCard.createDiv({ cls: "interview-qcard-header" });
    qHeader.createSpan({ cls: "diary-copilot-hero-badge", text: "💭 今日訪談引導" });

    const questionEn = this.currentFollowUpQ?.en || "What was the most meaningful or memorable thing that happened today?";
    const questionZh = this.currentFollowUpQ?.zh || "今天發生了什麼最有意義、或是最讓你印象深刻的事？";

    const listenQBtn = qHeader.createEl("button", {
      cls: "diary-copilot-action-btn interview-listen-btn",
      text: "🔊 聽問題發音",
    });
    listenQBtn.addEventListener("click", () => {
      speakSentence(questionEn);
    });

    const qBody = qCard.createDiv({ cls: "interview-q-en", text: questionEn });
    qCard.createDiv({ cls: "interview-q-zh", text: questionZh });

    // Answer Mic Hero
    const answerPrompt = interviewSection.createDiv({ cls: "diary-copilot-voice-prompt-title" });
    answerPrompt.setText("🎙️ 開口回答問題（講中文或英文皆可，AI 自動轉化為道地日記）：");

    this.renderMicHeroComponent(interviewSection, (spokenText, existingRange) => {
      this.processSpokenThought(spokenText, existingRange);
    });

    if (this.isLoading) {
      const loader = interviewSection.createDiv({ cls: "diary-copilot-voice-loading-box" });
      loader.createSpan({ cls: "loading-spinner" });
      loader.createSpan({ text: "✨ 正在將您的回答轉化為道地英語..." });
    } else if (this.currentRefineResult) {
      this.renderRefineCards(interviewSection, this.currentRefineResult);
    }
  }

  // --- Common Microphone Hero Component ---
  private renderMicHeroComponent(parentEl: HTMLElement, onSubmitSpoken: (text: string) => void) {
    const micContainer = parentEl.createDiv({ cls: "diary-copilot-voice-mic-container" });

    // Language selector pills: allow user to speak Mandarin/mixed or English (ZERO DOM re-render on click!)
    const langRow = micContainer.createDiv({ cls: "diary-copilot-voice-lang-row" });
    const zhBtn = langRow.createEl("button", {
      cls: `diary-copilot-voice-lang-btn ${this.speechLang === "zh-TW" ? "is-active" : ""}`,
      text: "🇹🇼 說中文 / 中英混",
    });
    const enBtn = langRow.createEl("button", {
      cls: `diary-copilot-voice-lang-btn ${this.speechLang === "en-US" ? "is-active" : ""}`,
      text: "🇺🇸 說英文 (English)",
    });

    zhBtn.addEventListener("click", () => {
      this.speechLang = "zh-TW";
      zhBtn.addClass("is-active");
      enBtn.removeClass("is-active");
      if (this.isListening) {
        this.stopListening();
      }
    });

    enBtn.addEventListener("click", () => {
      this.speechLang = "en-US";
      enBtn.addClass("is-active");
      zhBtn.removeClass("is-active");
      if (this.isListening) {
        this.stopListening();
      }
    });

    this.micHeroBtnEl = micContainer.createEl("button", {
      cls: `diary-copilot-voice-mic-hero ${this.isListening ? "is-listening" : ""}`,
    });
    this.micIconEl = this.micHeroBtnEl.createSpan({ cls: "mic-icon", text: this.isListening ? "⏹️" : "🎙️" });
    this.micLabelEl = this.micHeroBtnEl.createSpan({
      cls: "mic-label",
      text: this.isListening ? "正在聆聽... 說完請按此結束" : "按一下開始說話（無倒數限制）",
    });

    // Speech Transcript Input Box (works across Android Web Speech and iOS Keyboard Dictation)
    const transcriptBox = micContainer.createDiv({ cls: "diary-copilot-voice-transcript-wrapper" });
    const textInput = transcriptBox.createEl("input", {
      type: "text",
      cls: "diary-copilot-voice-transcript-input",
      value: this.currentTranscript,
      placeholder: Platform.isIosApp
        ? "輕按空白鍵旁 🎙️ 聽寫，或按右側 📋 帶入選取 ➔"
        : "點擊上方麥克風說話，或按 📋 帶入筆記選取 ➔",
    });

    textInput.addEventListener("input", (e) => {
      this.currentTranscript = (e.target as HTMLInputElement).value;
    });

    const triggerSubmit = async () => {
      const text = this.currentTranscript.trim();
      if (text) {
        const existingRange = this.locateSentenceInEditor(text);
        onSubmitSpoken(text, existingRange);
      } else {
        // Fallback: auto-read selection or clipboard
        const imported = await this.handleImportOrPaste(textInput, onSubmitSpoken);
        if (!imported) {
          new Notice("請先開口說話、在上方筆記選取句子，或在此輸入內容");
        }
      }
    };

    textInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        await triggerSubmit();
      }
    });

    // 📋 帶入選取/貼上 按鈕
    const pasteBtn = transcriptBox.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-voice-paste-btn",
      text: Platform.isMobile ? "📋 帶入" : "📋 帶入選取",
      attr: {
        "aria-label": "帶入筆記中選取的句子或剪貼簿內容並潤飾",
        title: "帶入筆記中選取的句子或剪貼簿內容並潤飾",
      },
    });
    pasteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const success = await this.handleImportOrPaste(textInput, onSubmitSpoken);
      if (!success) {
        new Notice("未在筆記中偵測到選取文字或剪貼簿內容");
      }
    });

    const sendBtn = transcriptBox.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-voice-send-btn",
      text: "⚡ 產生道地句",
    });
    sendBtn.addEventListener("click", async () => {
      await triggerSubmit();
    });

    // Wire speech recognition toggle
    this.micHeroBtnEl.addEventListener("click", () => {
      if (this.isListening) {
        this.stopListening();
        if (this.currentTranscript.trim()) {
          const text = this.currentTranscript.trim();
          const existingRange = this.locateSentenceInEditor(text);
          onSubmitSpoken(text, existingRange);
        }
      } else {
        this.currentTranscript = "";
        textInput.value = "";
        this.startListening((transcript) => {
          this.currentTranscript = transcript;
          textInput.value = transcript;
        });
      }
    });
  }

  private async handleImportOrPaste(
    inputEl: HTMLInputElement,
    onSubmit: (text: string, existingRange?: { from: number; to: number; sourceText: string; rawInserted: string } | null) => void
  ): Promise<boolean> {
    // 1. Try reading editor active selection first
    const sel = this.callbacks.getEditorSelection?.();
    if (sel && sel.text.length > 0) {
      this.currentTranscript = sel.text;
      inputEl.value = sel.text;
      new Notice(`📋 已帶入筆記選取句子：${sel.text.slice(0, 30)}...`, 2000);
      const existingRange = {
        from: sel.from,
        to: sel.to,
        sourceText: sel.text,
        rawInserted: sel.text,
      };
      onSubmit(sel.text, existingRange);
      return true;
    }

    // 2. Try reading system clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim().length > 0) {
          const text = clipText.trim();
          this.currentTranscript = text;
          inputEl.value = text;
          const located = this.callbacks.onLocateDocText?.(text);
          const existingRange = located
            ? { from: located.from, to: located.to, sourceText: text, rawInserted: text }
            : null;
          new Notice(`📋 已貼上剪貼簿內容並潤飾：${text.slice(0, 30)}...`, 2000);
          onSubmit(text, existingRange);
          return true;
        }
      }
    } catch (err) {
      console.warn("Clipboard access denied or unavailable", err);
    }

    return false;
  }

  private locateSentenceInEditor(text: string): { from: number; to: number; sourceText: string; rawInserted: string } | null {
    const sel = this.callbacks.getEditorSelection?.();
    if (sel && sel.text === text) {
      return { from: sel.from, to: sel.to, sourceText: text, rawInserted: text };
    }
    const located = this.callbacks.onLocateDocText?.(text);
    if (located) {
      return { from: located.from, to: located.to, sourceText: text, rawInserted: text };
    }
    return null;
  }

  private startListening(onResult: (transcript: string) => void) {
    if (globalSpeechRecognizer.isSupported()) {
      this.isListening = true;
      this.updateMicVisuals(true);
      globalSpeechRecognizer.start(
        this.speechLang,
        {
          onResult: (t) => onResult(t),
          onError: () => {
            this.isListening = false;
            this.updateMicVisuals(false);
          },
          onEnd: () => {
            this.isListening = false;
            this.updateMicVisuals(false);
          },
        },
        12000
      );
    } else {
      // Focus input field for iOS keyboard dictation / native Win+H
      const inputEl = this.containerEl.querySelector(".diary-copilot-voice-transcript-input") as HTMLInputElement;
      inputEl?.focus();
      new Notice(Platform.isIosApp ? "請輕按鍵盤空白鍵旁的 🎙️ 語音按鈕開口說" : "請按 Win+H 或使用鍵盤語音輸入");
    }
  }

  private stopListening() {
    this.isListening = false;
    this.updateMicVisuals(false);
    globalSpeechRecognizer.stop();
  }

  private updateMicVisuals(isListening: boolean) {
    if (this.micHeroBtnEl) {
      if (isListening) {
        this.micHeroBtnEl.addClass("is-listening");
        this.micIconEl?.setText("⏹️");
        this.micLabelEl?.setText("正在聆聽... 說完請按此結束");
      } else {
        this.micHeroBtnEl.removeClass("is-listening");
        this.micIconEl?.setText("🎙️");
        this.micLabelEl?.setText("按一下開始說話（無倒數限制）");
      }
    }
  }

  // --- Process Speech via Gemini LLM ---
  private async processSpokenThought(
    spoken: string,
    existingDraftInfo?: { from: number; to: number; sourceText: string; rawInserted: string } | null
  ) {
    if (!spoken.trim()) return;
    this.isLoading = true;
    this.currentRefineResult = null;

    if (existingDraftInfo) {
      // The sentence already exists in editor (e.g. copied/selected from editor) - do NOT duplicate gray draft!
      this.currentDraftInfo = existingDraftInfo;
    } else {
      // Fresh spoken/typed thought: insert as gray draft text into editor
      try {
        if (this.callbacks.onInsertSpokenDraft) {
          const range = await this.callbacks.onInsertSpokenDraft(spoken.trim());
          if (range && range.rawInserted) {
            this.currentDraftInfo = {
              ...range,
              sourceText: spoken.trim(),
            };
          }
        }
      } catch (err) {
        console.warn("Failed to insert spoken draft into editor", err);
      }
    }

    this.render();
    this.callbacks.onCardRenderChange?.();

    try {
      const level = this.callbacks.getEnglishLevel();
      const tone = this.callbacks.getTone();
      const diaryContext = this.callbacks.getDiaryContext();

      const sysPrompt = buildVoiceRefineSystemPrompt(level, tone);
      const userPrompt = buildVoiceRefineUserPrompt({
        spokenInput: spoken,
        diaryContext,
        englishLevel: level,
        tone,
      });

      const fullResponse = await this.llm.complete({
        systemPrompt: sysPrompt,
        userPrompt,
        temperature: 0.4,
        maxOutputTokens: 1200,
      });

      const parsed = parseVoiceRefineResponse(fullResponse);
      if (parsed) {
        this.currentRefineResult = parsed;
        if (parsed.followUpQuestion) {
          this.currentFollowUpQ = {
            en: parsed.followUpQuestion,
            zh: parsed.followUpChinese,
          };
        }
      } else {
        new Notice("⚠️ 語音提煉失敗，請重試");
      }
    } catch (e: any) {
      new Notice(`語音轉譯異常：${e?.message || e}`);
    } finally {
      this.isLoading = false;
      this.render();
      this.callbacks.onCardRenderChange?.();
    }
  }

  // --- Render 3 Refined Cards ---
  private renderRefineCards(parentEl: HTMLElement, result: VoiceRefineResult) {
    const cardsWrapper = parentEl.createDiv({ cls: "diary-copilot-voice-cards-wrapper" });

    const cardData = [
      { id: "natural", badge: "🌿 自然口語", text: result.natural },
      { id: "reflective", badge: "💭 深度反思", text: result.reflective },
      { id: "idiomatic", badge: "⚡ 精煉地道", text: result.idiomatic },
    ];

    cardData.forEach((c) => {
      if (!c.text) return;
      const cardEl = cardsWrapper.createDiv({ cls: "diary-copilot-voice-card" });

      const header = cardEl.createDiv({ cls: "diary-copilot-hero-header" });
      header.createSpan({ cls: "diary-copilot-hero-badge", text: c.badge });

      // Sentence body
      const textEl = cardEl.createDiv({ cls: "diary-copilot-voice-card-text", text: c.text });

      // Actions inside card
      const actRow = cardEl.createDiv({ cls: "diary-copilot-voice-card-actions" });

      // 1. 🔊 聽示範
      const listenBtn = actRow.createEl("button", {
        cls: "diary-copilot-action-btn",
        text: "🔊 聽示範",
      });
      listenBtn.addEventListener("click", () => {
        speakSentence(c.text);
      });

      // 2. 🎙️ 開口跟讀
      const shadowBtn = actRow.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-oral-btn",
        text: "🎙️ 跟讀練發音",
      });
      shadowBtn.addEventListener("click", () => {
        this.practicingCardText = c.text;
        this.startCardShadowing(c.text, cardEl);
      });

      // 3. ⚡ 填入 (取代筆記中的口說灰字)
      const appendBtn = actRow.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
        text: "⚡ 填入",
        attr: { title: "填入編輯區，取代口說初稿灰字" },
      });
      appendBtn.addEventListener("click", async () => {
        await this.callbacks.onAppendSentence(c.text, this.currentDraftInfo || undefined, "continue");
        this.adoptedCount++;
        this.currentDraftInfo = null;
        new Notice("🎉 已填入並替換口說初稿！", 2500);

        // If follow-up question exists, transition to interview
        if (this.currentFollowUpQ) {
          this.activeTab = "interview";
        }
        this.currentTranscript = "";
        this.currentRefineResult = null;
        this.render();
      });
    });
  }

  // --- Inline Speech Shadowing Verification inside Card ---
  private startCardShadowing(targetText: string, cardEl: HTMLElement) {
    // Clear any previous feedback in this card
    const existingFeedback = cardEl.querySelector(".diary-copilot-voice-shadow-feedback");
    if (existingFeedback) {
      existingFeedback.remove();
    }

    const feedbackBox = cardEl.createDiv({ cls: "diary-copilot-voice-shadow-feedback" });

    const statusRow = feedbackBox.createDiv({ cls: "shadow-status-row" });
    const statusText = statusRow.createSpan({ cls: "shadow-status-text", text: "🎙️ 正在聆聽，請隨意開口複誦標準句..." });
    const stopBtn = statusRow.createEl("button", {
      cls: "diary-copilot-action-btn shadow-stop-btn",
      text: "⏹️ 結束",
    });
    stopBtn.addEventListener("click", () => {
      globalSpeechRecognizer.stop();
      statusText.setText("⏹️ 已停止跟讀錄音");
      stopBtn.remove();
    });

    const resultBox = feedbackBox.createDiv({ cls: "shadow-result-box" });

    if (globalSpeechRecognizer.isSupported()) {
      globalSpeechRecognizer.start(
        "en-US",
        {
          onResult: (spoken, isFinal) => {
            const evalRes = evaluateOralMatch(spoken, targetText, isFinal);
            const scorePct = Math.round(evalRes.matchRatio * 100);
            resultBox.setText(`吻合度：${scorePct}% · 聽到：${evalRes.spokenText}`);

            if (evalRes.isPass) {
              globalSpeechRecognizer.stop();
              stopBtn.remove();
              feedbackBox.addClass("is-passed");
              statusText.setText(`🎉 完美過關！吻合度：${scorePct}%`);
              resultBox.setText(`🗣️ 辨識語音：${evalRes.spokenText}`);

              // Provide buttons: adopt immediately OR retry OR let user stay as long as they want!
              const actRow = feedbackBox.createDiv({ cls: "shadow-pass-btn-row" });
              const adoptBtn = actRow.createEl("button", {
                cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
                text: "⚡ 立即填入取代",
                attr: { title: "將此標準句填入筆記並取代初稿" },
              });
              const retryBtn = actRow.createEl("button", {
                cls: "diary-copilot-action-btn",
                text: "🔄 再練一次",
                attr: { title: "再次練習此句發音" },
              });

              let isAdopted = false;
              const doAdopt = async () => {
                if (isAdopted) return;
                isAdopted = true;
                await this.callbacks.onAppendSentence(targetText, this.currentDraftInfo || undefined, "oral");
                this.adoptedCount++;
                this.currentDraftInfo = null;
                if (this.currentFollowUpQ) this.activeTab = "interview";
                this.currentTranscript = "";
                this.currentRefineResult = null;
                this.render();
              };

              adoptBtn.addEventListener("click", () => {
                doAdopt();
              });

              retryBtn.addEventListener("click", () => {
                feedbackBox.remove();
                this.startCardShadowing(targetText, cardEl);
              });
            }
          },
          onError: (err) => {
            statusText.setText(`辨識結束 (${err})`);
          },
        },
        35000 // 35 seconds silence timeout: give ample relaxed time for long sentences
      );
    } else {
      feedbackBox.setText("🎧 請聆聽上方示範發音，並使用鍵盤語音聽寫練讀。滿意後請點擊「⚡ 填入」。");
    }
  }
}
