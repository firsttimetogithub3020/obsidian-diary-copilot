import { Plugin, MarkdownView, TFile, Platform } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { DEFAULT_SETTINGS, DiaryCopilotSettingTab } from "./settings";
import { PluginData, PluginSettings, SuggestionItem } from "./types";
import { GeminiProvider } from "./llm/gemini";
import { SummaryManager } from "./engine/summary";
import { SuggestionScheduler } from "./engine/scheduler";
import { extractContextFromDoc } from "./engine/context";
import { CardPanel } from "./ui/cardPanel";
import { ghostTextField, setGhostTextEffect } from "./ui/ghostText";
import { createDiaryKeymap } from "./ui/keymap";
import { openTodayDiary } from "./commands/openToday";
import { tidyUpTodayDiary } from "./commands/tidyUp";

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
          this.cardPanel?.setLoading();
          this.clearGhostText();
        },
        onSuggestion: (item: SuggestionItem, isStreaming: boolean) => {
          this.cardPanel?.updateSuggestions(item);
          if (this.settings.showGhostText && !Platform.isMobile && item.continueText) {
            this.setGhostText(item.continueText);
          }
        },
        onError: () => {
          this.cardPanel?.setError();
          this.clearGhostText();
        },
        onUsageIncrement: (inTokens, outTokens) => {
          this.recordUsage(inTokens, outTokens);
        },
      }
    );

    // Register UI & Keymap Editor Extensions
    this.registerEditorExtension([
      ghostTextField,
      createDiaryKeymap({
        getCurrentSuggestion: () => this.scheduler.getCurrentSuggestion(),
        onAdopt: (text, kind, sourceRange) => this.adoptSuggestion(text, kind, sourceRange),
        onDismiss: () => {
          this.scheduler.clear();
          this.cardPanel?.hide();
          this.clearGhostText();
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
    });
  }

  onunload() {
    this.cardPanel?.destroy();
    this.cardPanel = null;
    this.scheduler.clear();
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
            this.scheduler.clear();
            this.cardPanel?.hide();
            this.clearGhostText();
          },
        });
      }
    } else {
      this.activeView = null;
      this.cardPanel?.destroy();
      this.cardPanel = null;
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
      return; // Skip cursor moves and selection changes per SPEC §3.2
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

    if (kind === "translation" && sourceRange) {
      // Replace the Chinese text segment
      from = sourceRange.from;
      to = sourceRange.to;
      insertText = text;
    } else {
      // Insert at cursor
      // Ensure leading space if preceding character is not whitespace
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
    this.scheduler.clear();
    this.cardPanel?.hide();
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
