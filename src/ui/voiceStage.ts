import { Platform, Notice } from "obsidian";
import type { GeminiClient } from "../llm/gemini";
import type { EnglishLevel, DiaryTone } from "../types";
import { buildVoiceRefineSystemPrompt, buildVoiceRefineUserPrompt } from "../llm/prompts";
import { parseVoiceRefineResponse, VoiceRefineResult } from "../engine/parser";
import { speakSentence, stopAudio } from "../services/tts";
import { globalSpeechRecognizer, evaluateOralMatch } from "../services/speech";

export interface VoiceStageCallbacks {
  onAppendSentence: (sentence: string) => Promise<void>;
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
  private currentTranscript = "";
  private currentRefineResult: VoiceRefineResult | null = null;
  private currentFollowUpQ: { en: string; zh?: string } | null = null;
  private adoptedCount = 0;

  // Oral practice state within voice stage
  private practicingCardText: string | null = null;

  constructor(containerEl: HTMLElement, llm: GeminiClient, callbacks: VoiceStageCallbacks) {
    this.containerEl = containerEl;
    this.llm = llm;
    this.callbacks = callbacks;
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
    this.renderMicHeroComponent(cardSection, (spokenText) => {
      this.processSpokenThought(spokenText);
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

    this.renderMicHeroComponent(interviewSection, (spokenText) => {
      this.processSpokenThought(spokenText);
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

    const micHeroBtn = micContainer.createEl("button", {
      cls: `diary-copilot-voice-mic-hero ${this.isListening ? "is-listening" : ""}`,
    });
    micHeroBtn.createSpan({ cls: "mic-icon", text: this.isListening ? "⏹️" : "🎙️" });
    micHeroBtn.createSpan({
      cls: "mic-label",
      text: this.isListening ? "正在聆聽... 點此結束" : "按一下開始說話",
    });

    // Speech Transcript Input Box (works across Android Web Speech and iOS Keyboard Dictation)
    const transcriptBox = micContainer.createDiv({ cls: "diary-copilot-voice-transcript-wrapper" });
    const textInput = transcriptBox.createEl("input", {
      type: "text",
      cls: "diary-copilot-voice-transcript-input",
      value: this.currentTranscript,
      placeholder: Platform.isIosApp
        ? "點此開啟鍵盤，輕按空白鍵旁 🎙️ 聽寫，說完按右側送出 ➔"
        : "點擊上方麥克風說話，或在此手動輸入語音 ➔",
    });

    textInput.addEventListener("input", (e) => {
      this.currentTranscript = (e.target as HTMLInputElement).value;
    });

    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.currentTranscript.trim()) {
        onSubmitSpoken(this.currentTranscript.trim());
      }
    });

    const sendBtn = transcriptBox.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-voice-send-btn",
      text: "⚡ 產生道地句",
    });
    sendBtn.addEventListener("click", () => {
      if (this.currentTranscript.trim()) {
        onSubmitSpoken(this.currentTranscript.trim());
      } else {
        new Notice("請先開口說話或輸入內容");
      }
    });

    // Wire speech recognition toggle
    micHeroBtn.addEventListener("click", () => {
      if (this.isListening) {
        this.stopListening();
        if (this.currentTranscript.trim()) {
          onSubmitSpoken(this.currentTranscript.trim());
        }
      } else {
        this.startListening((transcript, isFinal) => {
          this.currentTranscript = transcript;
          textInput.value = transcript;
          if (isFinal && transcript.trim()) {
            this.stopListening();
            onSubmitSpoken(transcript.trim());
          }
        });
      }
    });
  }

  private startListening(onResult: (transcript: string, isFinal: boolean) => void) {
    if (globalSpeechRecognizer.isSupported()) {
      this.isListening = true;
      globalSpeechRecognizer.start("en-US", {
        onResult: (t, final) => onResult(t, final),
        onError: () => {
          this.isListening = false;
        },
        onEnd: () => {
          this.isListening = false;
        },
      });
      this.render();
    } else {
      // Focus input field for iOS keyboard dictation / native Win+H
      const inputEl = this.containerEl.querySelector(".diary-copilot-voice-transcript-input") as HTMLInputElement;
      inputEl?.focus();
      new Notice(Platform.isIosApp ? "請輕按鍵盤空白鍵旁的 🎙️ 語音按鈕開口說" : "請按 Win+H 或使用鍵盤語音輸入");
    }
  }

  private stopListening() {
    this.isListening = false;
    globalSpeechRecognizer.stop();
  }

  // --- Process Speech via Gemini LLM ---
  private async processSpokenThought(spoken: string) {
    if (!spoken.trim()) return;
    this.isLoading = true;
    this.currentRefineResult = null;
    this.render();

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

      let fullResponse = "";
      await this.llm.generateStream(sysPrompt, userPrompt, (chunk) => {
        fullResponse += chunk;
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

      // 3. ⚡ 直接加入今日日記
      const appendBtn = actRow.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
        text: "⚡ 加入日記",
      });
      appendBtn.addEventListener("click", async () => {
        await this.callbacks.onAppendSentence(c.text);
        this.adoptedCount++;
        new Notice("🎉 已加入今日日記！", 2500);

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
    const feedbackBox = cardEl.createDiv({ cls: "diary-copilot-voice-shadow-feedback" });
    feedbackBox.setText("🎙️ 請開口複誦上述句子...");

    if (globalSpeechRecognizer.isSupported()) {
      globalSpeechRecognizer.start("en-US", {
        onResult: (spoken, isFinal) => {
          const evalRes = evaluateOralMatch(spoken, targetText, isFinal);
          feedbackBox.setText(`吻合度：${Math.round(evalRes.matchRatio * 100)}% · ${evalRes.spokenText}`);
          if (evalRes.isPass) {
            globalSpeechRecognizer.stop();
            feedbackBox.setText("🎉 完美過關！吻合度高！已自動為您加入今日日記！");
            feedbackBox.addClass("is-passed");
            window.setTimeout(async () => {
              await this.callbacks.onAppendSentence(targetText);
              this.adoptedCount++;
              if (this.currentFollowUpQ) this.activeTab = "interview";
              this.currentTranscript = "";
              this.currentRefineResult = null;
              this.render();
            }, 1200);
          }
        },
        onError: (err) => {
          feedbackBox.setText(`辨識結束或請重新嘗試 (${err})`);
        },
      });
    } else {
      feedbackBox.setText("🎧 請聆聽上方示範發音，並使用鍵盤語音聽寫練讀。滿意後請點擊「⚡ 加入日記」。");
    }
  }
}
