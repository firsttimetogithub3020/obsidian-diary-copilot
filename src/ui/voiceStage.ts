import { Platform, Notice } from "obsidian";
import type { GeminiClient } from "../llm/gemini";
import type { EnglishLevel, DiaryTone } from "../types";
import { buildVoiceRefineSystemPrompt, buildVoiceRefineUserPrompt } from "../llm/prompts";
import { parseVoiceRefineResponse, VoiceRefineResult } from "../engine/parser";
import { speakSentence } from "../services/tts";
import { globalSpeechRecognizer, evaluateOralMatch } from "../services/speech";

export interface VoiceStageCallbacks {
  onInsertSpokenDraft?: (spokenText: string) => Promise<{ from: number; to: number; rawInserted: string }>;
  onAppendSentence: (
    sentence: string,
    draftInfo?: { from: number; to: number; sourceText: string; rawInserted: string },
    kind?: "continue" | "oral"
  ) => Promise<void>;
  getEditorSelection?: () => { text: string; from: number; to: number } | null;
  onGetSentenceToPolish?: () => { text: string; from: number; to: number } | null;
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
  private isLoading = false;
  private currentRefineResult: VoiceRefineResult | null = null;
  private currentFollowUpQ: { en: string; zh?: string } | null = null;
  private adoptedCount = 0;

  // Active spoken/written draft tracking for replacement
  private currentDraftInfo: { from: number; to: number; sourceText: string; rawInserted: string } | null = null;

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
  }

  // --- PILLAR A: 隨心說 (Free Speech / Thought to 3 Refined Cards) ---
  private renderFreeSpeechView(parentEl: HTMLElement) {
    const cardSection = parentEl.createDiv({ cls: "diary-copilot-voice-speech-section" });

    // Guidance Banner
    const guideBox = cardSection.createDiv({ cls: "diary-copilot-voice-guide-box" });
    guideBox.createDiv({
      cls: "diary-copilot-voice-guide-title",
      text: "💬 隨心記錄心情與日常（支援中英混雜）",
    });
    guideBox.createDiv({
      cls: "diary-copilot-voice-guide-sub",
      text: "在筆記編輯區直接用鍵盤打字或按鍵盤麥克風語音輸入。完成後點擊下方「✨ 潤飾句子」，Copilot 即提煉 3 種地道母語卡片。",
    });

    // Polish Action Bar
    this.renderPolishActionBar(cardSection, "free");

    // AI Refined 3 Cards Display
    if (this.isLoading) {
      const loader = cardSection.createDiv({ cls: "diary-copilot-voice-loading-box" });
      loader.createSpan({ cls: "loading-spinner" });
      loader.createSpan({ text: "✨ AI 正在為您提煉 3 種地道母語風格表達..." });
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

    const refreshQBtn = qHeader.createEl("button", {
      cls: "diary-copilot-action-btn interview-refresh-btn",
      text: "🔄 換個問題",
      attr: { title: "更換另一個訪談主題問題" },
    });
    refreshQBtn.addEventListener("click", () => {
      this.fetchNewInterviewQuestion();
    });

    qCard.createDiv({ cls: "interview-q-en", text: questionEn });
    qCard.createDiv({ cls: "interview-q-zh", text: questionZh });

    // Polish Action Bar
    this.renderPolishActionBar(interviewSection, "interview");

    if (this.isLoading) {
      const loader = interviewSection.createDiv({ cls: "diary-copilot-voice-loading-box" });
      loader.createSpan({ cls: "loading-spinner" });
      loader.createSpan({ text: "✨ 正在將您的回答轉化為 3 種地道母語卡片..." });
    } else if (this.currentRefineResult) {
      this.renderRefineCards(interviewSection, this.currentRefineResult);
    }
  }

  // --- Polish Action Bar: Trigger polish on editor selection / latest input ---
  private renderPolishActionBar(parentEl: HTMLElement, mode: "interview" | "free") {
    const bar = parentEl.createDiv({ cls: "diary-copilot-voice-polish-bar" });

    const polishBtn = bar.createEl("button", {
      cls: "diary-copilot-voice-polish-btn",
      text: mode === "interview" ? "✨ 潤飾我的回答" : "✨ 潤飾句子 / 選取文字",
      attr: {
        title: "將上方筆記中選取或最新輸入的一句話提煉為 3 種地道卡片",
      },
    });
    polishBtn.addEventListener("click", async () => {
      await this.handleTriggerPolish();
    });

    const clipBtn = bar.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-voice-clip-btn",
      text: "📋 帶入剪貼簿",
      attr: {
        title: "貼上剪貼簿內容並提煉地道卡片",
      },
    });
    clipBtn.addEventListener("click", async () => {
      await this.handleClipPolish();
    });
  }

  private fetchNewInterviewQuestion() {
    const presetQuestions = [
      { en: "What was the most meaningful or memorable thing that happened today?", zh: "今天發生了什麼最有意義、或是最讓你印象深刻的事？" },
      { en: "Did you encounter any unexpected challenge today, and how did you handle it?", zh: "今天有沒有遇到什麼意想不到的挑戰，你是如何應對的？" },
      { en: "Who was someone you interacted with today, and what made the conversation interesting?", zh: "今天有和誰互動，什麼讓那段對話變得有趣或印象深刻？" },
      { en: "What is one small win or moment of gratitude you experienced today?", zh: "今天有哪一件值得感謝的小小成就或溫暖片刻？" },
      { en: "What thought or question has been lingering in your mind lately?", zh: "最近有什麼想法、疑問或感悟一直在你腦海中盤旋？" },
      { en: "How are you feeling about your current goals and rhythm of life?", zh: "你對目前的生活節奏和前進目標感覺如何？" },
    ];
    const currentIndex = presetQuestions.findIndex((q) => q.en === this.currentFollowUpQ?.en);
    const nextIdx = (currentIndex + 1) % presetQuestions.length;
    this.currentFollowUpQ = presetQuestions[nextIdx];
    this.currentRefineResult = null;
    this.render();
    this.callbacks.onCardRenderChange?.();
  }

  private async handleTriggerPolish() {
    const target = this.callbacks.onGetSentenceToPolish?.();
    if (target && target.text.trim().length > 0) {
      const cleanText = target.text.trim();
      const existingRange = {
        from: target.from,
        to: target.to,
        sourceText: cleanText,
        rawInserted: cleanText,
      };
      new Notice(`✨ 正在潤飾筆記內容：${cleanText.slice(0, 25)}...`, 1500);
      await this.processSpokenThought(cleanText, existingRange);
      return;
    }

    const clipHandled = await this.handleClipPolish(true);
    if (!clipHandled) {
      new Notice("請先在上方筆記寫下或輸入一句話，或按「📋 帶入剪貼簿」");
    }
  }

  private async handleClipPolish(silentFail = false): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim().length > 0) {
          const text = clipText.trim();
          const located = this.callbacks.onLocateDocText?.(text);
          const existingRange = located
            ? { from: located.from, to: located.to, sourceText: text, rawInserted: text }
            : null;
          new Notice(`📋 已帶入剪貼簿內容並潤飾：${text.slice(0, 25)}...`, 1500);
          await this.processSpokenThought(text, existingRange);
          return true;
        }
      }
      if (!silentFail) {
        new Notice("剪貼簿內尚無文字內容");
      }
    } catch (err) {
      if (!silentFail) {
        new Notice("無法讀取剪貼簿，請先在筆記中輸入文字");
      }
    }
    return false;
  }

  // --- Process Thought via Gemini LLM ---
  private async processSpokenThought(
    spoken: string,
    existingDraftInfo?: { from: number; to: number; sourceText: string; rawInserted: string } | null
  ) {
    if (!spoken.trim()) return;
    this.isLoading = true;
    this.currentRefineResult = null;

    if (existingDraftInfo) {
      this.currentDraftInfo = existingDraftInfo;
    } else {
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
      cardEl.createDiv({ cls: "diary-copilot-voice-card-text", text: c.text });

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
        this.startCardShadowing(c.text, cardEl);
      });

      // 3. ⚡ 填入 (取代筆記中的初稿句)
      const appendBtn = actRow.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
        text: "⚡ 填入",
        attr: { title: "填入編輯區，取代原句子或初稿" },
      });
      appendBtn.addEventListener("click", async () => {
        await this.callbacks.onAppendSentence(c.text, this.currentDraftInfo || undefined, "continue");
        this.adoptedCount++;
        this.currentDraftInfo = null;
        new Notice("🎉 已填入並替換！", 2500);

        if (this.currentFollowUpQ) {
          this.activeTab = "interview";
        }
        this.currentRefineResult = null;
        this.render();
      });
    });
  }

  // --- Inline Speech Shadowing Verification inside Card ---
  private startCardShadowing(targetText: string, cardEl: HTMLElement) {
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
        35000
      );
    } else {
      feedbackBox.setText("🎧 請聆聽上方示範發音，並使用鍵盤語音聽寫練讀。滿意後請點擊「⚡ 填入」。");
    }
  }
}
