import { Plugin, MarkdownView, TFile, Platform, Notice } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { DEFAULT_SETTINGS, DiaryCopilotSettingTab } from "./settings";
import { PluginData, PluginSettings, SuggestionItem } from "./types";
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
          if (this.settings.showGhostText && !Platform.isMobile && ghostStr) {
            this.setGhostText(ghostStr);
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
          return this.isPolishMode ? this.currentPolishItem : this.scheduler.getCurrentSuggestion();
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
    document.body.style.removeProperty("--diary-copilot-card-height");
    document.body.style.removeProperty("--diary-copilot-max-lines");
    document.body.style.removeProperty("--diary-copilot-panel-height");
  }

  applyAppearanceSettings() {
    const cardHeight = this.settings.cardMinHeight || 64;
    const maxLines = this.settings.cardMaxLines || 3;
    const panelHeight = this.settings.panelMinHeight || 115;
    document.body.style.setProperty("--diary-copilot-card-height", `${cardHeight}px`);
    document.body.style.setProperty("--diary-copilot-max-lines", `${maxLines}`);
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
      const systemPrompt = buildPolishSystemPrompt(this.settings.englishLevel);
      const userPrompt = buildPolishUserPrompt({
        targetSentence: target.sentence,
        surroundingContext: target.surroundingContext,
        englishLevel: this.settings.englishLevel,
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

  private setGhostText(text: string) {
    if (!this.currentActiveEditorView) return;
    this.currentActiveEditorView.dispatch({
      effects: setGhostTextEffect.of(text),
    });
  }

  private clearGhostText() {
    if (!this.currentActiveEditorView) return;
    this.currentActiveEditorView.dispatch({
      effects: setGhostTextEffect.of(null),
    });
  }

  adoptSuggestion(text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) {
    if (!this.activeView || !this.currentActiveEditorView) return;

    const editorView = this.currentActiveEditorView;
    const cleanText = text.trim();

    // IF sourceRange exists (Chinese replacement OR F3 polish):
    // 1. DELETE the original text immediately!
    // 2. TURN the chosen text into GHOST TEXT so the user can SHADOW-WRITE it!
    if (sourceRange) {
      const from = sourceRange.from;
      const to = sourceRange.to;

      editorView.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
        userEvent: "delete",
      });

      this.isPolishMode = false;
      this.currentPolishItem = null;

      // Start shadow typing session for this chosen text at `from`
      this.scheduler.startShadowTyping(cleanText, from);
      this.setGhostText(cleanText);

      new Notice(kind === "translation" ? "✍️ 已消除原文字，請跟寫練習！" : "✍️ 已清除原句，請跟寫潤飾！", 2500);
      return;
    }

    // Normal continuation mode (Card 1, 2, 3, or 4 chosen)
    // Turn chosen text into ghost text for shadow-typing!
    const cursor = editorView.state.selection.main.head;
    let targetText = cleanText;

    const doc = editorView.state.doc;
    if (cursor > 0) {
      const prevChar = doc.sliceString(cursor - 1, cursor);
      if (!/\s/.test(prevChar) && !targetText.startsWith(" ")) {
        targetText = " " + targetText;
      }
    }

    this.scheduler.startShadowTyping(targetText, cursor);
    this.setGhostText(targetText);
    new Notice("✍️ 已切換建議，請跟寫練習！", 2000);
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
