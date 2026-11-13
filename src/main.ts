import { Plugin, MarkdownView, TFile, Platform, Notice } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { DEFAULT_SETTINGS, DiaryCopilotSettingTab, DIARY_TONE_OPTIONS } from "./settings";
import { PluginData, PluginSettings, SuggestionItem, DiaryTone } from "./types";
import { GeminiProvider } from "./llm/gemini";
import { SummaryManager } from "./engine/summary";
import { SuggestionScheduler } from "./engine/scheduler";
import { extractContextFromDoc, extractSentenceToPolish } from "./engine/context";
import { CardPanel } from "./ui/cardPanel";
import { ghostTextField, setGhostTextEffect } from "./ui/ghostText";
import { createDiaryKeymap } from "./ui/keymap";
import { openTodayDiary } from "./commands/openToday";
import { tidyUpTodayDiary } from "./commands/tidyUp";
import { buildPolishSystemPrompt, buildPolishUserPrompt } from "./llm/prompts";

export default class DiaryCopilotPlugin extends Plugin {
  settings: PluginSettings;
  data: PluginData;
  llm: GeminiProvider;
  summaryManager: SummaryManager;
  scheduler: SuggestionScheduler;

  // Active view tracking
  private activeView: MarkdownView | null = null;
  private cardPanel: CardPanel | null = null;
  private currentActiveEditorView: EditorView | null = null;
  private isPolishMode = false;
  private currentPolishItem: SuggestionItem | null = null;

  async onload() {
    await this.loadPluginData();

    this.llm = new GeminiProvider(this.settings.geminiApiKey, this.settings.model);
    this.summaryManager = new SummaryManager(this.app.vault, this.llm);

    // Initialize SuggestionScheduler
    this.scheduler = new SuggestionScheduler(
      this.llm,
      () => this.settings,
      {
        onLoading: () => {
          if (!this.isPolishMode) {
            this.cardPanel?.setLoading();
          }
        },
        onSuggestion: (item: SuggestionItem) => {
          if (this.isPolishMode) return;
          this.cardPanel?.updateSuggestions(item, false);

          const ghostStr = item?.card1 || item?.continueText;
          if (this.settings.showGhostText && !Platform.isMobile && ghostStr && this.currentActiveEditorView) {
            const cursor = this.currentActiveEditorView.state.selection.main.head;
            this.setGhostText(ghostStr, cursor);
          }
        },
        onError: () => {
          if (!this.isPolishMode) {
            this.cardPanel?.setError();
            this.clearGhostText();
          }
        },
        onUsageIncrement: (inTokens, outTokens) => {
          this.recordUsage(inTokens, outTokens);
        },
        onShadowComplete: (completedText: string) => {
          new Notice("🎉 跟寫練習完成！", 2000);
          this.recordAdoption(completedText, "shadow");
          this.clearGhostText();
        },
      }
    );

    // Register UI & Keymap Editor Extensions
    this.registerEditorExtension([
      ghostTextField,
      createDiaryKeymap({
        getCurrentSuggestion: () => {
          return this.isPolishMode
            ? this.currentPolishItem
            : (this.cardPanel?.getCurrentItem() || this.scheduler.getCurrentSuggestion());
        },
        onAdopt: (text, kind, sourceRange) => this.adoptSuggestion(text, kind, sourceRange),
        onDismiss: () => {
          this.isPolishMode = false;
          this.currentPolishItem = null;
          this.scheduler.clear();
          this.cardPanel?.hide();
          this.clearGhostText();
        },
        onPolishRequest: () => {
          this.handlePolishSentence();
        },
      }),
      EditorView.updateListener.of((update: ViewUpdate) => {
        this.handleEditorUpdate(update);
      }),
    ]);

    // Global Key Listener for Alt+1/2/3/4 card selection across all layouts & IMEs
    this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.code === "Digit1" || e.key === "1") {
          if (this.triggerCardAdopt(1)) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else if (e.code === "Digit2" || e.key === "2") {
          if (this.triggerCardAdopt(2)) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else if (e.code === "Digit3" || e.key === "3") {
          if (this.triggerCardAdopt(3)) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else if (e.code === "Digit4" || e.key === "4") {
          if (this.triggerCardAdopt(4)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    });

    // Register Commands
    this.addCommand({
      id: "open-today-diary",
      name: "開啟今日日記",
      callback: () => openTodayDiary(this.app, this),
    });

    this.addCommand({
      id: "polish-sentence",
      name: "潤飾當前/前一句表達 (F3)",
      callback: () => this.handlePolishSentence(),
    });

    this.addCommand({
      id: "tidy-up-today-diary",
      name: "整理今日日記",
      checkCallback: (checking: boolean) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
          const folder = this.settings.diaryFolder || "Diary";
          if (activeView.file.path.startsWith(folder + "/")) {
            if (!checking) {
              tidyUpTodayDiary(this.app, this);
            }
            return true;
          }
        }
        return false;
      },
    });

    // Register Setting Tab
    this.addSettingTab(new DiaryCopilotSettingTab(this.app, this));

    // Listen to active leaf changes to mount/unmount CardPanel
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.syncActiveView();
      })
    );

    // Initial sync
    this.app.workspace.onLayoutReady(() => {
      this.syncActiveView();
      this.checkAndGenerateDailyStyleSummary();
      this.applyAppearanceSettings();
    });
  }

  onunload() {
    this.cardPanel?.destroy();
    this.cardPanel = null;
    this.scheduler.clear();
    document.body.style.removeProperty("--diary-copilot-font-size");
    document.body.style.removeProperty("--diary-copilot-panel-height");
  }

  applyAppearanceSettings() {
    const fontSize = this.settings.cardFontSize || 13.5;
    const panelHeight = this.settings.panelMinHeight || 160;
    document.body.style.setProperty("--diary-copilot-font-size", `${fontSize}px`);
    document.body.style.setProperty("--diary-copilot-panel-height", `${panelHeight}px`);
  }

  async loadPluginData() {
    const rawData = await this.loadData();
    this.data = Object.assign(
      {
        settings: DEFAULT_SETTINGS,
        adoptions: {},
        styleSummary: { summary: "", lastUpdated: "" },
        usage: {},
      },
      rawData
    );
    this.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings);
  }

  async saveSettings() {
    this.data.settings = this.settings;
    this.llm.updateConfig(this.settings.geminiApiKey, this.settings.model);
    this.applyAppearanceSettings();
    await this.saveData(this.data);
  }

  async testGeminiConnection(): Promise<boolean> {
    return await this.llm.testConnection();
  }

  private isDiaryFile(file: TFile | null): boolean {
    if (!file) return false;
    const folder = this.settings.diaryFolder || "Diary";
    return file.path.startsWith(folder + "/");
  }

  private syncActiveView() {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (activeMarkdownView && this.isDiaryFile(activeMarkdownView.file)) {
      if (this.activeView !== activeMarkdownView) {
        this.cardPanel?.destroy();

        this.activeView = activeMarkdownView;
        this.cardPanel = new CardPanel(activeMarkdownView.contentEl, {
          onAdopt: (text, kind, sourceRange) => this.adoptSuggestion(text, kind, sourceRange),
          onDismiss: () => {
            this.isPolishMode = false;
            this.currentPolishItem = null;
            this.scheduler.clear();
            this.cardPanel?.hide();
            this.clearGhostText();
          },
          onHeightResize: async (newHeight: number) => {
            this.settings.panelMinHeight = newHeight;
            await this.saveSettings();
          },
          getTone: () => this.settings.diaryTone,
          onToneChange: (tone) => this.handleToneChange(tone),
        });
      }
    } else {
      this.activeView = null;
      this.cardPanel?.destroy();
      this.cardPanel = null;
      this.isPolishMode = false;
      this.currentPolishItem = null;
      this.scheduler.clear();
      this.clearGhostText();
    }
  }

  async handleToneChange(tone: DiaryTone) {
    this.settings.diaryTone = tone;
    await this.saveSettings();

    const option = DIARY_TONE_OPTIONS.find((t) => t.id === tone);
    new Notice(`🎭 語調切換為：${option?.label || tone}`, 2000);

    // If active diary view exists, re-fetch suggestions with new tone immediately!
    if (this.currentActiveEditorView && this.activeView && this.isDiaryFile(this.activeView.file)) {
      const docText = this.currentActiveEditorView.state.doc.toString();
      const cursor = this.currentActiveEditorView.state.selection.main.head;
      const context = extractContextFromDoc(docText, cursor);
      const filePath = this.activeView.file.path;
      const paragraphSummary = this.summaryManager.getParagraphSummary(filePath);
      const styleSummary = this.data.styleSummary?.summary;

      this.scheduler.refetch(context, styleSummary, paragraphSummary);
    }
  }

  private handleEditorUpdate(update: ViewUpdate) {
    this.currentActiveEditorView = update.view;

    if (!this.activeView || !this.isDiaryFile(this.activeView.file)) {
      return;
    }

    if (!update.docChanged) {
      return;
    }

    // Typing exits polish mode back to prediction mode
    if (this.isPolishMode) {
      this.isPolishMode = false;
      this.currentPolishItem = null;
    }

    const docText = update.state.doc.toString();
    const cursor = update.state.selection.main.head;
    const context = extractContextFromDoc(docText, cursor);

    const filePath = this.activeView.file?.path || "";
    const paragraphSummary = this.summaryManager.getParagraphSummary(filePath);
    const styleSummary = this.data.styleSummary?.summary;

    // Trigger scheduler
    this.scheduler.handleDocChange(context, styleSummary, paragraphSummary);

    // Update paragraph summary in background if newline was inserted
    for (const tr of update.transactions) {
      if (tr.docChanged) {
        tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
          if (inserted.toString().includes("\n")) {
            this.summaryManager.updateParagraphSummary(filePath, docText);
          }
        });
      }
    }
  }

  async handlePolishSentence() {
    if (!this.activeView || !this.currentActiveEditorView) {
      new Notice("請先在日記編輯器內操作");
      return;
    }

    const editorView = this.currentActiveEditorView;
    const docText = editorView.state.doc.toString();
    const cursor = editorView.state.selection.main.head;

    const target = extractSentenceToPolish(docText, cursor);
    if (!target || target.sentence.length === 0) {
      new Notice("游標附近未偵測到需要潤飾的句子");
      return;
    }

    this.isPolishMode = true;
    this.cardPanel?.setLoading("✨ 正在為您構思 4 種更地道優雅的表達方式...");
    this.clearGhostText();

    try {
      const systemPrompt = buildPolishSystemPrompt(this.settings.englishLevel, this.settings.diaryTone);
      const userPrompt = buildPolishUserPrompt({
        targetSentence: target.sentence,
        surroundingContext: target.surroundingContext,
        englishLevel: this.settings.englishLevel,
        tone: this.settings.diaryTone,
      });

      const responseText = await this.llm.complete({
        systemPrompt,
        userPrompt,
        temperature: 0.7,
        maxOutputTokens: 350,
      });

      let cleaned = responseText.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "");
      }

      const parsed = JSON.parse(cleaned);
      const polishItem: SuggestionItem = {
        card1: parsed.card1 || parsed.option1 || "",
        card2: parsed.card2 || parsed.option2 || "",
        card3: parsed.card3 || parsed.option3 || "",
        card4: parsed.card4 || parsed.option4 || "",
        continueText: parsed.card1 || parsed.option1 || "",
        alternativeText: parsed.card2 || parsed.option2 || "",
        translationText: parsed.card3 || parsed.option3 || "",
        translationSource: target.sentence,
        sourceRange: { from: target.from, to: target.to },
      };

      this.currentPolishItem = polishItem;
      this.cardPanel?.updateSuggestions(polishItem, true);

      if (this.settings.showGhostText && !Platform.isMobile && polishItem.card1) {
        this.setGhostText(polishItem.card1);
      }
    } catch (e: any) {
      this.isPolishMode = false;
      this.currentPolishItem = null;
      this.cardPanel?.setError();
      new Notice(`潤飾失敗：${e?.message || e}`);
    }
  }

  private setGhostText(text: string | null, anchorPos?: number) {
    if (!this.currentActiveEditorView) return;
    if (!text) {
      this.clearGhostText();
      return;
    }
    const pos = anchorPos ?? this.currentActiveEditorView.state.selection.main.head;
    this.currentActiveEditorView.dispatch({
      effects: setGhostTextEffect.of({ targetText: text, anchorPos: pos }),
    });
  }

  private clearGhostText() {
    if (!this.currentActiveEditorView) return;
    this.currentActiveEditorView.dispatch({
      effects: setGhostTextEffect.of(null),
    });
  }

  triggerCardAdopt(cardNumber: 1 | 2 | 3 | 4): boolean {
    const item = this.isPolishMode
      ? this.currentPolishItem
      : (this.cardPanel?.getCurrentItem() || this.scheduler.getCurrentSuggestion());

    if (!item) return false;

    let text = "";
    if (cardNumber === 1) text = item.card1 || item.continueText || "";
    else if (cardNumber === 2) text = item.card2 || item.alternativeText || "";
    else if (cardNumber === 3) text = item.card3 || item.translationText || "";
    else if (cardNumber === 4) text = item.card4 || "";

    if (!text || text.trim().length === 0) return false;

    const kind = item.sourceRange ? "translation" : (cardNumber === 1 ? "continue" : "alternative");
    this.adoptSuggestion(text, kind, item.sourceRange);
    return true;
  }

  adoptSuggestion(text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) {
    if (!this.activeView || !this.currentActiveEditorView) return;

    const editorView = this.currentActiveEditorView;
    const cleanText = text.trim();

    let targetPos = editorView.state.selection.main.head;

    // IF sourceRange exists (Chinese replacement OR F3 polish):
    if (sourceRange) {
      const from = sourceRange.from;
      const to = sourceRange.to;

      // Delete the original Chinese or English sentence
      editorView.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
        userEvent: "delete",
      });

      targetPos = from;
      this.isPolishMode = false;
      this.currentPolishItem = null;
    }

    // Start shadow typing session for this chosen text at `targetPos`
    this.scheduler.startShadowTyping(cleanText, targetPos);
    this.setGhostText(cleanText, targetPos);

    new Notice(sourceRange ? "✍️ 已消除原文字，請跟寫練習！" : "✍️ 已套用建議，請跟寫練習！", 2000);
  }

  recordAdoption(text: string, kind: string) {
    if (!text || text.trim().length === 0) return;
    const todayDate = this.activeView?.file ? this.activeView.file.basename : new Date().toISOString().slice(0, 10);
    if (!this.data.adoptions[todayDate]) {
      this.data.adoptions[todayDate] = [];
    }
    this.data.adoptions[todayDate].push({
      text: text.trim(),
      kind: kind as any,
      timestamp: Date.now(),
    });
    this.saveData(this.data);
  }

  private recordUsage(inTokens: number, outTokens: number) {
    const today = new Date().toISOString().slice(0, 10);
    if (!this.data.usage[today]) {
      this.data.usage[today] = { requests: 0, inputTokens: 0, outputTokens: 0 };
    }
    this.data.usage[today].requests += 1;
    this.data.usage[today].inputTokens += inTokens;
    this.data.usage[today].outputTokens += outTokens;
    this.saveData(this.data);
  }

  private async checkAndGenerateDailyStyleSummary() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.styleSummary?.lastUpdated !== today && this.settings.geminiApiKey) {
      const summary = await this.summaryManager.generateStyleSummary(this.settings.diaryFolder);
      if (summary) {
        this.data.styleSummary = {
          summary,
          lastUpdated: today,
        };
        await this.saveData(this.data);
      }
    }
  }
}
