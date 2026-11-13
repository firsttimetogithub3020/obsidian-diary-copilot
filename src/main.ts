import { Plugin, MarkdownView, TFile, Platform, Notice } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { DEFAULT_SETTINGS, DiaryCopilotSettingTab } from "./settings";
import { PluginData, PluginSettings, SuggestionItem } from "./types";
import { GeminiProvider } from "./llm/gemini";
import { SummaryManager } from "./engine/summary";
import { SuggestionScheduler } from "./engine/scheduler";
import { extractContextFromDoc, extractSentenceToPolish } from "./engine/context";
import { CardPanel } from "./ui/cardPanel";
import { FloatingCapsule } from "./ui/floatingCapsule";
import { ghostTextField, setGhostTextEffect } from "./ui/ghostText";
import { createDiaryKeymap } from "./ui/keymap";
import { openTodayDiary } from "./commands/openToday";
import { tidyUpTodayDiary } from "./commands/tidyUp";
import { buildPolishSystemPrompt, buildPolishUserPrompt } from "./llm/prompts";

interface ActiveChineseSession {
  chineseText: string;
  sourceRange?: { from: number; to: number };
}

export default class DiaryCopilotPlugin extends Plugin {
  settings: PluginSettings;
  data: PluginData;
  llm: GeminiProvider;
  summaryManager: SummaryManager;
  scheduler: SuggestionScheduler;

  // Active view tracking
  private activeView: MarkdownView | null = null;
  private cardPanel: CardPanel | null = null;
  private floatingCapsule: FloatingCapsule | null = null;
  private currentActiveEditorView: EditorView | null = null;
  private isPolishMode = false;
  private currentPolishItem: SuggestionItem | null = null;
  private activeChineseSession: ActiveChineseSession | null = null;

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
        onSuggestion: (item: SuggestionItem, isStreaming: boolean, isChinesePractice: boolean) => {
          if (this.isPolishMode) return;
          this.cardPanel?.updateSuggestions(item, false);

          if (isChinesePractice && item.translationText) {
            this.activeChineseSession = {
              chineseText: item.translationSource || "",
              sourceRange: item.sourceRange,
            };

            // Display floating capsule at cursor
            if (this.currentActiveEditorView && this.floatingCapsule) {
              const head = this.currentActiveEditorView.state.selection.main.head;
              const coords = this.currentActiveEditorView.coordsAtPos(head);
              if (coords) {
                this.floatingCapsule.show(item.translationText, coords.left, coords.bottom);
              }
            }

            // Display ghost text for practice
            if (this.settings.showGhostText && !Platform.isMobile) {
              this.setGhostText(item.continueText || item.translationText);
            }
          } else {
            this.floatingCapsule?.hide();
            this.activeChineseSession = null;
            if (this.settings.showGhostText && !Platform.isMobile && item.continueText) {
              this.setGhostText(item.continueText);
            }
          }
        },
        onError: () => {
          if (!this.isPolishMode) {
            this.cardPanel?.setError();
            this.floatingCapsule?.hide();
            this.clearGhostText();
          }
        },
        onUsageIncrement: (inTokens, outTokens) => {
          this.recordUsage(inTokens, outTokens);
        },
        onChinesePracticeComplete: () => {
          this.cleanupChineseAfterPractice();
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
          this.activeChineseSession = null;
          this.floatingCapsule?.hide();
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

    // Listen to active leaf changes to mount/unmount CardPanel & FloatingCapsule
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
    this.floatingCapsule?.destroy();
    this.floatingCapsule = null;
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
        this.floatingCapsule?.destroy();

        this.activeView = activeMarkdownView;
        this.cardPanel = new CardPanel(activeMarkdownView.contentEl, {
          onAdopt: (text, kind, sourceRange) => this.adoptSuggestion(text, kind, sourceRange),
          onDismiss: () => {
            this.isPolishMode = false;
            this.currentPolishItem = null;
            this.activeChineseSession = null;
            this.floatingCapsule?.hide();
            this.scheduler.clear();
            this.cardPanel?.hide();
            this.clearGhostText();
          },
          onHeightResize: async (newHeight: number) => {
            this.settings.panelMinHeight = newHeight;
            await this.saveSettings();
          },
        });

        this.floatingCapsule = new FloatingCapsule(activeMarkdownView.contentEl);
      }
    } else {
      this.activeView = null;
      this.cardPanel?.destroy();
      this.cardPanel = null;
      this.floatingCapsule?.destroy();
      this.floatingCapsule = null;
      this.isPolishMode = false;
      this.currentPolishItem = null;
      this.activeChineseSession = null;
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

    // Trigger scheduler (with shadow-typing prefix retention & Chinese practice)
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

  private cleanupChineseAfterPractice() {
    if (!this.currentActiveEditorView || !this.activeChineseSession) return;

    const editorView = this.currentActiveEditorView;
    const doc = editorView.state.doc.toString();
    const cursor = editorView.state.selection.main.head;
    const session = this.activeChineseSession;

    // Search backwards from cursor for the Chinese text
    const textBefore = doc.slice(0, cursor);
    const chinesePos = textBefore.lastIndexOf(session.chineseText);

    if (chinesePos !== -1) {
      let from = chinesePos;
      let to = chinesePos + session.chineseText.length;

      // Also clean up trailing space after Chinese if present
      if (doc[to] === " ") {
        to++;
      }

      editorView.dispatch({
        changes: { from, to, insert: "" },
        userEvent: "input",
      });

      new Notice("🎉 英文跟寫完成！中文已自動清除", 2500);
    }

    this.activeChineseSession = null;
    this.floatingCapsule?.hide();
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
    this.floatingCapsule?.hide();
    this.cardPanel?.setLoading("✨ 正在為您構思 3 種更地道優雅的表達方式...");
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
        maxOutputTokens: 300,
      });

      let cleaned = responseText.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "");
      }

      const parsed = JSON.parse(cleaned);
      const polishItem: SuggestionItem = {
        continueText: parsed.option1 ? String(parsed.option1).trim() : "",
        alternativeText: parsed.option2 ? String(parsed.option2).trim() : "",
        translationText: parsed.option3 ? String(parsed.option3).trim() : null,
        translationSource: target.sentence,
        sourceRange: { from: target.from, to: target.to },
      };

      this.currentPolishItem = polishItem;
      this.cardPanel?.updateSuggestions(polishItem, true);

      if (this.settings.showGhostText && !Platform.isMobile && polishItem.continueText) {
        this.setGhostText(polishItem.continueText);
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
    const cursor = editorView.state.selection.main.head;

    let from = cursor;
    let to = cursor;
    let insertText = text;

    if (sourceRange) {
      // Direct replacement for Polish mode or specific target
      from = sourceRange.from;
      to = sourceRange.to;
      insertText = text;
      new Notice("✨ 已替換為更佳表達！", 2000);
    } else {
      // Normal insert at cursor
      const doc = editorView.state.doc;
      if (from > 0) {
        const prevChar = doc.sliceString(from - 1, from);
        if (!/\s/.test(prevChar) && !insertText.startsWith(" ")) {
          insertText = " " + insertText;
        }
      }
    }

    editorView.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
      userEvent: "input",
    });

    // If we were in Chinese practice session, clean up the Chinese text now!
    if (this.activeChineseSession) {
      this.cleanupChineseAfterPractice();
    }

    // Record adoption
    const todayDate = this.activeView.file ? this.activeView.file.basename : new Date().toISOString().slice(0, 10);
    if (!this.data.adoptions[todayDate]) {
      this.data.adoptions[todayDate] = [];
    }
    this.data.adoptions[todayDate].push({
      text,
      kind,
      source: sourceRange ? editorView.state.doc.sliceString(sourceRange.from, sourceRange.to) : undefined,
      timestamp: Date.now(),
    });
    this.saveData(this.data);

    // Clear active suggestions and ghost text
    this.isPolishMode = false;
    this.currentPolishItem = null;
    this.scheduler.clear();
    this.cardPanel?.hide();
    this.floatingCapsule?.hide();
    this.clearGhostText();
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
