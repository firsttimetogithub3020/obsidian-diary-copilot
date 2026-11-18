import { Plugin, MarkdownView, TFile, Platform, Notice } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { DEFAULT_SETTINGS, DiaryCopilotSettingTab, DIARY_TONE_OPTIONS, GEPT_LEVEL_OPTIONS } from "./settings";
import { PluginData, PluginSettings, SuggestionItem, DiaryTone, InquiryItem, EnglishLevel } from "./types";
import { GeminiProvider } from "./llm/gemini";
import { SummaryManager } from "./engine/summary";
import { SuggestionScheduler } from "./engine/scheduler";
import { extractContextFromDoc, extractSentenceToPolish } from "./engine/context";
import { CardPanel, forceDismissSoftKeyboard } from "./ui/cardPanel";
import { ghostTextField, setGhostTextEffect, draftMarkField, setDraftMarkEffect } from "./ui/ghostText";
import { createDiaryKeymap } from "./ui/keymap";
import { openTodayDiary } from "./commands/openToday";
import { tidyUpTodayDiary } from "./commands/tidyUp";
import { buildPolishSystemPrompt, buildPolishUserPrompt, buildInquirySystemPrompt, buildInquiryUserPrompt } from "./llm/prompts";
import { parseInquiryResponse } from "./engine/parser";
import { SelectionPopover } from "./ui/selectionPopover";
import { FullTextShadowingModal } from "./ui/fullTextShadowingModal";
import { ShadowingPrepModal } from "./ui/shadowingPrepModal";
import { checkAndApplyPluginUpdate } from "./services/updater";
import { globalSpeechRecognizer } from "./services/speech";

export default class DiaryCopilotPlugin extends Plugin {
  settings: PluginSettings;
  data: PluginData;
  llm: GeminiProvider;
  summaryManager: SummaryManager;
  scheduler: SuggestionScheduler;

  // Active view tracking
  private activeView: MarkdownView | null = null;
  private currentFilePath = "";
  private cardPanel: CardPanel | null = null;
  private currentActiveEditorView: EditorView | null = null;
  private isPolishMode = false;
  private currentPolishItem: SuggestionItem | null = null;
  private isInquiryMode = false;
  private currentInquiryItem: InquiryItem | null = null;
  private manuallyEnabledNotes = new Set<string>();
  private manuallyDisabledNotes = new Set<string>();
  private isCopilotGloballyMuted = false;
  private selectionPopover: SelectionPopover | null = null;
  private ribbonIconEl: HTMLElement | null = null;
  private lastSelectedText = "";
  private lastSelectedRange: { from: number; to: number } | null = null;
  private lastSelectedTime = 0;

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

          // Unified behavior: NEVER auto-inject ghost text into editor above!
          // Ghost text is ONLY activated when user explicitly clicks card body for typing drill.
        },
        onError: () => {
          if (!this.isPolishMode) {
            const hasKey = !!this.settings.geminiApiKey;
            this.cardPanel?.setError(hasKey ? "⚠️ 連線異常，請檢查網路或模型" : "⚠️ 請先在 Diary Copilot 外掛設定中填入 Gemini API Key");
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
        onOralShadowComplete: (targetText: string, anchorPos: number, cursorOffset: number) => {
          const editorView = this.getEditorView();
          if (editorView) {
            editorView.dispatch({
              changes: {
                from: anchorPos,
                to: cursorOffset,
                insert: targetText,
              },
              selection: { anchor: anchorPos + targetText.length },
              userEvent: "input",
            });
          }
          new Notice("🎉 口說跟讀成功！已自動填入標準句子", 2500);
          this.recordAdoption(targetText, "oral");
          this.clearGhostText();
        },
        onShadowAbandon: () => {
          new Notice("已解鎖卡片", 1500);
          this.clearGhostText();
        },
      }
    );

    // Register UI & Keymap Editor Extensions
    this.registerEditorExtension([
      ghostTextField,
      draftMarkField,
      createDiaryKeymap({
        getCurrentSuggestion: () => {
          return this.isPolishMode
            ? this.currentPolishItem
            : (this.cardPanel?.getCurrentItem() || this.scheduler.getCurrentSuggestion());
        },
        onAdopt: (text, kind, sourceRange) => this.adoptSuggestion(text, kind, sourceRange),
        onDismiss: () => {
          this.handleDismiss();
        },
        onPolishRequest: () => {
          this.handlePolishSentence();
        },
        onInquiryRequest: () => {
          this.handleInquiryPrompt();
        },
        isShadowMode: () => this.scheduler.isShadowMode(),
        onDirectPaste: () => this.handleDirectPaste(),
      }),
      EditorView.updateListener.of((update: ViewUpdate) => {
        this.handleEditorUpdate(update);
      }),
    ]);

    // Global Key Listener for Tab (direct paste in shadow mode), Alt/Option+1/2/3/4 card selection, and Escape unlock
    this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (this.scheduler.isShadowMode()) {
          this.handleDirectPaste();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (e.key === "Escape") {
        if (this.scheduler.isShadowMode()) {
          this.handleDismiss();
          e.preventDefault();
          return;
        }
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.code === "Digit1" || e.key === "1" || e.key === "¡") {
          if (this.triggerCardAdopt(1)) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else if (e.code === "Digit2" || e.key === "2" || e.key === "™") {
          if (this.triggerCardAdopt(2)) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else if (e.code === "Digit3" || e.key === "3" || e.key === "£") {
          if (this.triggerCardAdopt(3)) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else if (e.code === "Digit4" || e.key === "4" || e.key === "¢") {
          if (this.triggerCardAdopt(4)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    });

    // Initialize Selection Popover for Instant Word/Phrase Lookup & Google Translate
    this.selectionPopover = new SelectionPopover({
      app: this.app,
      llm: this.llm,
      isEnabled: () => this.settings.enableSelectionLookup ?? true,
      onPolish: (text) => this.handlePolishSentence(text),
    });

    // Global mouseup/touchend for selection lookup across note editor, suggestion cards, ghost text, and locked screens
    const handleSelectionFromDOM = () => {
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;

        const rawText = sel.toString().trim();
        const text = rawText.replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+|[^a-zA-Z0-9\u4e00-\u9fa5]+$/g, "");
        if (text.length > 0 && text.length <= 350) {
          try {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            this.selectionPopover?.handleSelection(text, rect);
          } catch {}
        }
      }, 40);
    };

    this.registerDomEvent(window, "mouseup", handleSelectionFromDOM);
    this.registerDomEvent(window, "touchend", handleSelectionFromDOM);

    // Ribbon Icon on Left Sidebar (One-click toggle Copilot for current note, configurable in settings)
    this.updateRibbonIcon();

    // Register Commands
    this.addCommand({
      id: "toggle-copilot-current-note",
      name: "在當前筆記開啟／關閉 Copilot (開關指令優先，絕不自動重開)",
      callback: () => this.toggleCopilotInCurrentNote(),
    });

    this.addCommand({
      id: "toggle-copilot-globally",
      name: "全域開啟／關閉 Copilot 面板 (開關指令優先，絕不自動重開)",
      callback: () => this.toggleCopilotGlobally(),
    });

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
      id: "inquiry-guided-prompt",
      name: "提問引導：產生是非與開放式問句 (F5)",
      callback: () => this.handleInquiryPrompt(),
    });

    this.addCommand({
      id: "tidy-up-today-diary",
      name: "整理今日日記",
      checkCallback: (checking: boolean) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
          if (this.isEligibleNote(activeView.file)) {
            if (!checking) {
              tidyUpTodayDiary(this.app, this);
            }
            return true;
          }
        }
        return false;
      },
    });

    this.addCommand({
      id: "full-text-shadowing",
      name: "全篇沉浸影子跟讀 (Full-Text Shadowing)",
      callback: () => this.handleFullTextShadowing(),
    });

    this.addCommand({
      id: "toggle-voice-stage",
      name: "切換口說對話舞台 / 筆記卡片模式",
      callback: () => {
        this.cardPanel?.toggleVoiceStage();
      },
    });

    this.addCommand({
      id: "check-for-updates",
      name: "檢查並更新 Diary Copilot (Check for Updates)",
      callback: () => this.checkForUpdates(true),
    });

    // Register Setting Tab
    this.addSettingTab(new DiaryCopilotSettingTab(this.app, this));

    // Listen to active leaf and file changes to mount/unmount CardPanel
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.syncActiveView();
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.syncActiveView();
      })
    );

    // Initial sync
    this.app.workspace.onLayoutReady(() => {
      this.syncActiveView();
      this.checkAndGenerateDailyStyleSummary();
      this.applyAppearanceSettings();

      // Background update check on startup:
      // First attempt at 6 seconds; on mobile, retry at 20 seconds in case network needed time to wake up.
      window.setTimeout(async () => {
        const updated = await this.checkForUpdates(false);
        if (!updated && (Platform.isMobile || Platform.isAndroidApp)) {
          window.setTimeout(() => {
            this.checkForUpdates(false);
          }, 15000);
        }
      }, 6000);

      // Periodic check every 60 minutes
      this.registerInterval(
        window.setInterval(() => {
          this.checkForUpdates(false);
        }, 60 * 60 * 1000)
      );
    });
  }

  async checkForUpdates(manual: boolean = false): Promise<boolean> {
    return await checkAndApplyPluginUpdate(this.app, this.manifest, manual);
  }

  onunload() {
    this.cardPanel?.destroy();
    this.cardPanel = null;
    this.selectionPopover?.destroy();
    this.selectionPopover = null;
    this.scheduler.clear();
    document.body.removeClass("has-diary-copilot-active");
    document.body.style.removeProperty("--diary-copilot-font-size");
    document.body.style.removeProperty("--diary-copilot-panel-height");
  }

  getEffectiveFontSize(): number {
    try {
      const local = localStorage.getItem("diary-copilot-font-size");
      if (local) {
        const parsed = parseFloat(local);
        if (!isNaN(parsed) && parsed >= 10 && parsed <= 24) return parsed;
      }
    } catch {}
    return this.settings.cardFontSize || 13.5;
  }

  setEffectiveFontSize(size: number) {
    try {
      localStorage.setItem("diary-copilot-font-size", size.toString());
    } catch {}
    this.settings.cardFontSize = size;
  }

  getEffectivePanelHeight(): number {
    try {
      const local = localStorage.getItem("diary-copilot-panel-height");
      if (local) {
        const parsed = parseInt(local, 10);
        if (!isNaN(parsed) && parsed >= 80 && parsed <= 500) return parsed;
      }
    } catch {}
    return this.settings.panelMinHeight || 160;
  }

  setEffectivePanelHeight(height: number) {
    try {
      localStorage.setItem("diary-copilot-panel-height", height.toString());
    } catch {}
    this.settings.panelMinHeight = height;
  }

  getEffectiveCollapsedHeight(): number {
    try {
      const local = localStorage.getItem("diary-copilot-collapsed-height");
      if (local) {
        const parsed = parseInt(local, 10);
        if (!isNaN(parsed) && parsed >= 40 && parsed <= 140) return parsed;
      }
    } catch {}
    return this.settings.collapsedHeight || 60;
  }

  setEffectiveCollapsedHeight(height: number) {
    try {
      localStorage.setItem("diary-copilot-collapsed-height", height.toString());
    } catch {}
    this.settings.collapsedHeight = height;
  }

  applyAppearanceSettings() {
    const fontSize = this.getEffectiveFontSize();
    const panelHeight = this.getEffectivePanelHeight();
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
    if (!this.data.settings?.debounceMs || this.settings.debounceMs >= 400) {
      this.settings.debounceMs = 180;
    }
    if (!this.data.settings?.noPunctuationDebounceMs || this.settings.noPunctuationDebounceMs >= 800) {
      this.settings.noPunctuationDebounceMs = 350;
    }
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

  private isEligibleNote(file: TFile | null): boolean {
    if (!file) return false;
    const filePath = file.path;

    // 0. Globally muted has absolute priority!
    if (this.isCopilotGloballyMuted) return false;

    // 1. Manually disabled by user in this note has ABSOLUTE priority over everything!
    if (this.manuallyDisabledNotes.has(filePath)) {
      return false;
    }

    // 2. Expressions hub (Expressions.md or notes named *expression*): DEFAULT TO NEVER OPEN PANEL
    const baseNameLower = file.basename.toLowerCase();
    if (baseNameLower === "expressions" || baseNameLower.includes("expression")) {
      return this.manuallyEnabledNotes.has(filePath);
    }

    // 3. Explicitly enabled by user in this note
    if (this.manuallyEnabledNotes.has(filePath)) {
      return true;
    }

    if (this.settings.enableInAllFolders) return true;

    // 4. Configured Diary folder (default "Diary")
    const targetFolder = (this.settings.diaryFolder || "Diary")
      .replace(/[\[\]]/g, "")
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
    const filePathLower = filePath.toLowerCase();
    return filePathLower.startsWith(targetFolder + "/");
  }

  toggleCopilotGlobally() {
    this.isCopilotGloballyMuted = !this.isCopilotGloballyMuted;
    if (this.isCopilotGloballyMuted) {
      this.cardPanel?.destroy();
      this.cardPanel = null;
      this.clearGhostText();
      this.scheduler.clear();
      new Notice("已全域關閉 Diary Copilot 面板（開關指令優先，絕不自動重開）");
    } else {
      this.syncActiveView();
      new Notice("已全域開啟 Diary Copilot 面板");
    }
    this.updateRibbonIconState();
  }

  toggleCopilotInCurrentNote() {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeMarkdownView || !activeMarkdownView.file) {
      new Notice("請先開啟一篇筆記");
      return;
    }

    const filePath = activeMarkdownView.file.path;
    const isCurrentlyEligible = this.isEligibleNote(activeMarkdownView.file);

    if (isCurrentlyEligible && this.cardPanel && !this.cardPanel.isHidden()) {
      // User explicitly WANTS TO CLOSE!
      this.manuallyDisabledNotes.add(filePath);
      this.manuallyEnabledNotes.delete(filePath);
      this.cardPanel?.destroy();
      this.cardPanel = null;
      this.clearGhostText();
      this.scheduler.clear();
      new Notice("已關閉此筆記的 Copilot 面板（開關指令優先，絕不自動重開）");
    } else {
      // User explicitly WANTS TO OPEN!
      // If Copilot is currently globally muted, un-mute it so this explicit request takes effect!
      if (this.isCopilotGloballyMuted) {
        this.isCopilotGloballyMuted = false;
        this.updateRibbonIconState();
        new Notice("💡 已自動為您解除全域關閉，並在此筆記啟用 Copilot 面板");
      } else {
        new Notice("已在此筆記啟用 Copilot 面板");
      }
      this.manuallyDisabledNotes.delete(filePath);
      this.manuallyEnabledNotes.add(filePath);
      this.syncActiveView();
      if (this.cardPanel) {
        this.cardPanel.show();
      }
    }
  }

  getActiveMarkdownView(): MarkdownView | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file && this.isEligibleNote(activeView.file)) {
      this.activeView = activeView;
      return activeView;
    }
    if (this.activeView && this.activeView.file && this.isEligibleNote(this.activeView.file)) {
      if ((this.activeView as any).containerEl?.isConnected !== false) {
        return this.activeView;
      }
    }
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file && this.isEligibleNote(leaf.view.file)) {
        this.activeView = leaf.view;
        return leaf.view;
      }
    }
    return null;
  }

  syncActiveView() {
    const activeMarkdownView = this.getActiveMarkdownView();

    if (activeMarkdownView && this.isEligibleNote(activeMarkdownView.file)) {
      if (activeMarkdownView.editor) {
        const val = activeMarkdownView.editor.getValue();
        if (val.includes("<span style=")) {
          const sanitized = val.replace(/<span style="[^"]*">([\s\S]*?)<\/span>/g, "$1");
          if (sanitized !== val) {
            activeMarkdownView.editor.setValue(sanitized);
          }
        }
      }

      const isNewView = this.activeView !== activeMarkdownView;
      const fileChanged = this.currentFilePath !== (activeMarkdownView.file?.path || "");

      if (isNewView || !this.cardPanel) {
        this.cardPanel?.destroy();

        this.activeView = activeMarkdownView;
        this.currentFilePath = activeMarkdownView.file?.path || "";

        this.cardPanel = new CardPanel(activeMarkdownView.contentEl, {
          onAdopt: (text, kind, sourceRange, isDirectPaste) => this.adoptSuggestion(text, kind, sourceRange, isDirectPaste),
          onDismiss: () => {
            this.handleDismiss();
          },
          onHeightResize: async (newHeight: number) => {
            this.setEffectivePanelHeight(newHeight);
            this.applyAppearanceSettings();
            await this.saveSettings();
          },
          getTone: () => this.settings.diaryTone,
          onToneChange: (tone) => this.handleToneChange(tone),
          onPolishRequest: () => {
            this.handlePolishSentence();
          },
          onInquiryRequest: () => {
            this.handleInquiryPrompt();
          },
          onClose: () => {
            this.toggleCopilotInCurrentNote();
          },
          onCheckUpdate: () => {
            this.checkForUpdates(true);
          },
          onFontSizeChange: async (newSize: number) => {
            this.setEffectiveFontSize(newSize);
            this.applyAppearanceSettings();
            await this.saveSettings();
          },
          getFontSize: () => this.getEffectiveFontSize(),
          onCollapsedHeightChange: async (newHeight: number) => {
            this.setEffectiveCollapsedHeight(newHeight);
            await this.saveSettings();
          },
          getCollapsedHeight: () => this.getEffectiveCollapsedHeight(),
          onDirectPaste: () => {
            this.handleDirectPaste();
          },
          onOralAdopt: (text, kind, sourceRange) => {
            this.executeOralAdoption(text, kind, sourceRange);
          },
          onFocusEditor: () => {
            if (!Platform.isMobile) {
              activeMarkdownView.editor?.focus();
            }
          },
          onDismissKeyboard: () => {
            try {
              const activeEl = document.activeElement as HTMLElement;
              if (activeEl && typeof activeEl.blur === "function") {
                activeEl.blur();
              }
              (activeMarkdownView.editor as any)?.blur?.();
              (activeMarkdownView.editor as any)?.cm?.contentDOM?.blur?.();
            } catch {}
          },
          onCardSelect: (text, kind, sourceRange) => {
            this.adoptSuggestion(text, kind, sourceRange, false);
          },
          onUnlock: () => {
            this.scheduler.clear();
            this.clearGhostText();
            this.cardPanel?.renderIdleState();
            new Notice("已解鎖卡片", 1200);
          },
          onOralInput: (spokenText: string, targetText: string) => {
            if (this.scheduler.checkOralMatch(spokenText, targetText)) {
              globalSpeechRecognizer.stop();
              this.handleDirectPaste();
              new Notice("🎉 口說跟讀成功！已自動填入標準句子", 2500);
            }
          },
          onInsertSpokenDraft: async (spokenText: string) => {
            return await this.insertSpokenDraft(spokenText);
          },
          onAppendDiarySentence: async (
            sentence: string,
            draftInfo?: { from: number; to: number; sourceText: string; rawInserted: string },
            kind?: "continue" | "oral"
          ) => {
            await this.appendDiarySentence(sentence, draftInfo, kind);
          },
          getEditorSelection: () => {
            return this.getEditorSelection();
          },
          onLocateDocText: (text: string) => {
            return this.locateDocText(text);
          },
          onGetSentenceToPolish: () => {
            const activeView = this.getActiveMarkdownView();
            if (!activeView || !activeView.editor) return null;
            const editor = activeView.editor;
            const selectedText = editor.getSelection();
            if (selectedText && selectedText.trim().length > 0) {
              const fromPos = editor.getCursor("from");
              const toPos = editor.getCursor("to");
              return {
                text: selectedText.trim(),
                from: editor.posToOffset(fromPos),
                to: editor.posToOffset(toPos),
              };
            }
            const docText = editor.getValue();
            const cursor = editor.posToOffset(editor.getCursor());
            const target = extractSentenceToPolish(docText, cursor);
            if (target && target.sentence.trim().length > 0) {
              return {
                text: target.sentence.trim(),
                from: target.from,
                to: target.to,
              };
            }
            const lines = docText.split("\n");
            for (let i = lines.length - 1; i >= 0; i--) {
              const trimmed = lines[i].trim();
              if (trimmed.length > 0 && !trimmed.startsWith("#")) {
                const idx = docText.lastIndexOf(trimmed);
                return {
                  text: trimmed,
                  from: idx,
                  to: idx + trimmed.length,
                };
              }
            }
            return null;
          },
          onTidyUpRequest: () => {
            tidyUpTodayDiary(this.app, this);
          },
          onFullTextShadowingRequest: () => {
            this.handleFullTextShadowing();
          },
          getCopilotMode: () => {
            return this.settings.copilotMode || "compact";
          },
          onModeChange: async (mode: CopilotMode) => {
            this.settings.copilotMode = mode;
            await this.saveSettings();
            if (mode === "compact") {
              this.scheduler.clear();
              this.clearGhostText();
            }
          },
          getEnglishLevel: () => {
            return this.settings.englishLevel;
          },
          onEnglishLevelChange: async (level: EnglishLevel) => {
            await this.handleEnglishLevelChange(level);
          },
          getDiaryContext: () => {
            return this.getRecentDiaryContext();
          },
          getLlmClient: () => {
            return this.llm;
          },
        });
      } else if (fileChanged) {
        this.currentFilePath = activeMarkdownView.file?.path || "";
        this.scheduler.clear();
        this.clearGhostText();
        this.cardPanel?.renderIdleState();
      }

      // Check if API key is configured
      if (!this.settings.geminiApiKey) {
        this.cardPanel?.setError("⚠️ 請先在 Diary Copilot 外掛設定中填入 Gemini API Key");
        return;
      }

      // If document already has content upon opening/switching, auto-trigger suggestions for current position
      const editor = activeMarkdownView.editor;
      if (editor) {
        const docText = editor.getValue();
        const cursor = editor.posToOffset(editor.getCursor());
        if (docText.trim().length > 0) {
          const context = extractContextFromDoc(docText, cursor);
          const filePath = activeMarkdownView.file?.path || "";
          const paragraphSummary = this.summaryManager.getParagraphSummary(filePath);
          const styleSummary = this.data.styleSummary?.summary;
          this.scheduler.handleDocChange(context, styleSummary, paragraphSummary);
        } else {
          this.cardPanel?.renderIdleState();
        }
      }
    } else {
      this.activeView = null;
      this.currentFilePath = "";
      this.cardPanel?.destroy();
      this.cardPanel = null;
      this.isPolishMode = false;
      this.currentPolishItem = null;
      this.scheduler.clear();
      this.clearGhostText();
    }
  }

  handleDismiss() {
    if (this.scheduler.isShadowMode()) {
      // Trigger 3: ESC unlocks shadow-typing and immediately 0ms refetches 4 fresh cards!
      this.scheduler.clear();
      this.clearGhostText();
      new Notice("已解鎖卡片", 1500);

      if (this.currentActiveEditorView && this.activeView && this.isEligibleNote(this.activeView.file)) {
        const docText = this.currentActiveEditorView.state.doc.toString();
        const cursor = this.currentActiveEditorView.state.selection.main.head;
        const context = extractContextFromDoc(docText, cursor);
        const filePath = this.activeView.file.path;
        const paragraphSummary = this.summaryManager.getParagraphSummary(filePath);
        const styleSummary = this.data.styleSummary?.summary;

        this.scheduler.refetch(context, styleSummary, paragraphSummary);
      }
      return;
    }

    // Normal mode: reset cards to idle state, but KEEP PANEL DOCKED in eligible notes!
    this.isPolishMode = false;
    this.currentPolishItem = null;
    this.scheduler.clear();
    this.cardPanel?.renderIdleState();
    this.clearGhostText();
  }

  async handleToneChange(tone: DiaryTone) {
    this.settings.diaryTone = tone;
    await this.saveSettings();

    const option = DIARY_TONE_OPTIONS.find((t) => t.id === tone);
    new Notice(`🎭 語調切換為：${option?.label || tone}`, 2000);

    // If active note is eligible, re-fetch suggestions with new tone immediately!
    if (this.currentActiveEditorView && this.activeView && this.isEligibleNote(this.activeView.file)) {
      const docText = this.currentActiveEditorView.state.doc.toString();
      const cursor = this.currentActiveEditorView.state.selection.main.head;
      const context = extractContextFromDoc(docText, cursor);
      const filePath = this.activeView.file.path;
      const paragraphSummary = this.summaryManager.getParagraphSummary(filePath);
      const styleSummary = this.data.styleSummary?.summary;

      this.scheduler.refetch(context, styleSummary, paragraphSummary);
    }
  }

  async handleEnglishLevelChange(level: EnglishLevel) {
    this.settings.englishLevel = level;
    await this.saveSettings();

    const option = GEPT_LEVEL_OPTIONS.find((l) => l.id === level);
    const label = option ? `${option.icon} ${option.label} (${option.badge})` : level;
    new Notice(`🎯 英文難度切換為：${label}`, 2500);

    // If active note is eligible, re-fetch suggestions with new level immediately!
    if (this.currentActiveEditorView && this.activeView && this.isEligibleNote(this.activeView.file)) {
      const docText = this.currentActiveEditorView.state.doc.toString();
      const cursor = this.currentActiveEditorView.state.selection.main.head;
      const context = extractContextFromDoc(docText, cursor);
      const filePath = this.activeView.file.path;
      const paragraphSummary = this.summaryManager.getParagraphSummary(filePath);
      const styleSummary = this.data.styleSummary?.summary;

      this.scheduler.refetch(context, styleSummary, paragraphSummary);
    }
  }

  getRecentDiaryContext(): string {
    const activeView = this.getActiveMarkdownView();
    if (activeView && activeView.editor) {
      return activeView.editor.getValue().slice(-600);
    }
    return "";
  }

  getEditorSelection(): { text: string; from: number; to: number } | null {
    const activeView = this.getActiveMarkdownView();
    if (!activeView || !activeView.editor) return null;
    const editor = activeView.editor;
    const selectedText = editor.getSelection();
    if (selectedText && selectedText.trim().length > 0) {
      const fromPos = editor.getCursor("from");
      const toPos = editor.getCursor("to");
      return {
        text: selectedText.trim(),
        from: editor.posToOffset(fromPos),
        to: editor.posToOffset(toPos),
      };
    }
    return null;
  }

  locateDocText(text: string): { from: number; to: number } | null {
    const activeView = this.getActiveMarkdownView();
    if (!activeView || !activeView.editor) return null;
    const editor = activeView.editor;
    const doc = editor.getValue();
    const idx = doc.indexOf(text.trim());
    if (idx !== -1) {
      return { from: idx, to: idx + text.trim().length };
    }
    return null;
  }

  async insertSpokenDraft(spokenText: string): Promise<{ from: number; to: number; rawInserted: string }> {
    let activeView = this.getActiveMarkdownView();
    if (!activeView || !activeView.file) {
      await openTodayDiary(this.app, this);
      activeView = this.getActiveMarkdownView();
    }
    if (!activeView || !activeView.editor) {
      return { from: 0, to: 0, rawInserted: "" };
    }
    const editor = activeView.editor;

    // 1. Automatically sanitize any legacy raw HTML <span...> tags so note is clean Markdown
    let doc = editor.getValue();
    if (doc.includes("<span style=")) {
      const sanitized = doc.replace(/<span style="[^"]*">([\s\S]*?)<\/span>/g, "$1");
      if (sanitized !== doc) {
        editor.setValue(sanitized);
        doc = sanitized;
      }
    }

    const needsLeadingNewline = doc.length > 0 && !doc.endsWith("\n\n");
    const prefix = needsLeadingNewline ? (doc.endsWith("\n") ? "\n" : "\n\n") : "";

    // PURE CLEAN MARKDOWN TEXT - ZERO HTML TAGS!
    const cleanSpoken = spokenText.trim();
    const textToInsert = `${prefix}${cleanSpoken}\n`;

    const fromOffset = doc.length + prefix.length;
    const toOffset = fromOffset + cleanSpoken.length;

    const lastLine = editor.lineCount() - 1;
    const lastLineLength = editor.getLine(lastLine).length;
    editor.replaceRange(textToInsert, { line: lastLine, ch: lastLineLength });

    // Apply CodeMirror 6 inline draft mark decoration: renders as gray italic without touching document text!
    const editorView = this.getEditorView();
    if (editorView) {
      editorView.dispatch({
        effects: setDraftMarkEffect.of({ from: fromOffset, to: toOffset }),
      });
    }

    // Position cursor at the end of the newly inserted draft
    const newLastLine = editor.lineCount() - 1;
    editor.setCursor({ line: newLastLine, ch: editor.getLine(newLastLine).length });

    return {
      from: fromOffset,
      to: toOffset,
      rawInserted: cleanSpoken,
    };
  }

  async appendDiarySentence(
    sentence: string,
    draftInfo?: { from: number; to: number; sourceText: string; rawInserted: string },
    kind: "continue" | "oral" = "continue"
  ) {
    let activeView = this.getActiveMarkdownView();
    if (!activeView || !activeView.file) {
      await openTodayDiary(this.app, this);
      activeView = this.getActiveMarkdownView();
    }
    if (activeView && activeView.editor) {
      const editor = activeView.editor;
      let doc = editor.getValue();

      // Clean up legacy HTML tags if any remain
      if (doc.includes("<span style=")) {
        const sanitized = doc.replace(/<span style="[^"]*">([\s\S]*?)<\/span>/g, "$1");
        if (sanitized !== doc) {
          editor.setValue(sanitized);
          doc = sanitized;
        }
      }

      // If draftInfo is present, locate and replace the draft text in the editor
      if (draftInfo && draftInfo.rawInserted) {
        let fromOffset = draftInfo.from;
        let toOffset = draftInfo.to;

        if (doc.slice(fromOffset, toOffset) !== draftInfo.rawInserted) {
          const foundIdx = doc.lastIndexOf(draftInfo.rawInserted);
          if (foundIdx !== -1) {
            fromOffset = foundIdx;
            toOffset = foundIdx + draftInfo.rawInserted.length;
          }
        }

        if (doc.slice(fromOffset, toOffset) === draftInfo.rawInserted) {
          const fromPos = editor.offsetToPos(fromOffset);
          const toPos = editor.offsetToPos(toOffset);
          editor.replaceRange(sentence, fromPos, toPos);

          // Clear CodeMirror draft mark decoration
          const editorView = this.getEditorView();
          if (editorView) {
            editorView.dispatch({
              effects: setDraftMarkEffect.of(null),
            });
          }

          // Record adoption with the original spoken text as source for Tidy Up learning review
          this.recordAdoption(sentence, kind, draftInfo.sourceText);
          new Notice(kind === "oral" ? "🎉 跟讀達標！已替換初稿" : "⚡ 已填入並替換初稿！", 2000);
          return;
        }
      }

      // Fallback: append to the bottom of the diary
      const needsLeadingNewline = doc.length > 0 && !doc.endsWith("\n\n");
      const prefix = needsLeadingNewline ? (doc.endsWith("\n") ? "\n" : "\n\n") : "";
      const newText = `${prefix}${sentence}\n`;
      const lastLine = editor.lineCount() - 1;
      const lastLineLength = editor.getLine(lastLine).length;
      editor.replaceRange(newText, { line: lastLine, ch: lastLineLength });

      const editorView = this.getEditorView();
      if (editorView) {
        editorView.dispatch({
          effects: setDraftMarkEffect.of(null),
        });
      }

      this.recordAdoption(sentence, kind, draftInfo?.sourceText);
      new Notice("📝 已收錄至今日日記初稿", 1500);
    }
  }

  async handleFullTextShadowing() {
    let activeView = this.getActiveMarkdownView();
    if (!activeView || !activeView.file) {
      await openTodayDiary(this.app, this);
      activeView = this.getActiveMarkdownView();
    }
    if (!activeView || !activeView.file) {
      new Notice("請先開啟日記筆記");
      return;
    }
    const file = activeView.file;
    const content = await this.app.vault.read(file);

    // Try to find "## English" section
    const englishMatch = content.match(/##\s+English\s*\n([\s\S]*?)(?=\n##|$)/i);
    const existingEnglish = englishMatch && englishMatch[1]?.trim() ? englishMatch[1].trim() : null;

    // Strip frontmatter and markdown headings to extract raw draft text
    const rawDraft = content
      .replace(/^---\n[\s\S]*?\n---\s*/, "")
      .replace(/^#.*$/gm, "")
      .trim();

    if (!rawDraft && !existingEnglish) {
      new Notice("目前日記尚無內容可供整理或跟讀，請先在筆記中輸入文字");
      return;
    }

    new ShadowingPrepModal(this.app, this, rawDraft, file, existingEnglish).open();
  }

  private handleEditorUpdate(update: ViewUpdate) {
    this.currentActiveEditorView = update.view;

    // Selection popover lookup trigger (works across notes when enabled)
    if (this.settings.enableSelectionLookup && update.selectionSet) {
      const sel = update.view.state.selection.main;
      if (!sel.empty) {
        const from = sel.from;
        const to = sel.to;
        if (to - from <= 350) {
          const selectedText = update.view.state.sliceDoc(from, to).trim();
          this.lastSelectedText = selectedText;
          this.lastSelectedRange = { from, to };
          this.lastSelectedTime = Date.now();

          const cleanText = selectedText.replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+|[^a-zA-Z0-9\u4e00-\u9fa5]+$/g, "");
          if (cleanText.length > 0) {
            const startCoords = update.view.coordsAtPos(from);
            const endCoords = update.view.coordsAtPos(to);
            if (startCoords && endCoords) {
              const rect = {
                left: Math.min(startCoords.left, endCoords.left),
                top: Math.min(startCoords.top, endCoords.top),
                right: Math.max(startCoords.right, endCoords.right),
                bottom: Math.max(startCoords.bottom, endCoords.bottom),
              };
              this.selectionPopover?.handleSelection(cleanText, rect);
            }
          }
        }
      }
    }

    if (update.docChanged) {
      this.selectionPopover?.hide();
    }

    if (!this.activeView || !this.isEligibleNote(this.activeView.file)) {
      return;
    }

    if (!update.docChanged) {
      return;
    }

    // CRITICAL: If the user is actively in an IME composition (Pinyin, Zhuyin, or mobile keyboard voice dictation streaming):
    // DO NOT interrupt, do not trigger API requests, and do not dispatch any editor changes!
    if (update.view.composing) {
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

    // Option 1: Zero typing passive continuation distraction.
    // Typing never triggers automatic prediction cards or ghost text.
    // Diary Copilot operates purely on active user requests (❓ Inquiry, ✨ Polish, ✨ Shadowing) and Alt+1~4 shortcuts.

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

  async handlePolishSentence(explicitText?: string) {
    const activeMarkdownView = this.getActiveMarkdownView();
    if (!activeMarkdownView || !activeMarkdownView.file) {
      new Notice("請先在筆記編輯器內操作");
      return;
    }

    // Dismiss soft keyboard on mobile so user has full view of polish cards
    forceDismissSoftKeyboard();
    this.cardPanel?.dismissSoftKeyboard();
    this.cardPanel?.openCards(true);

    // If note is in another folder (e.g. 日記 or 書摘), auto-invoke Copilot for this note
    if (!this.isEligibleNote(activeMarkdownView.file)) {
      this.manuallyEnabledNotes.add(activeMarkdownView.file.path);
      this.syncActiveView();
    }

    const editor = activeMarkdownView.editor;
    const docText = editor.getValue();
    const cursor = editor.posToOffset(editor.getCursor());

    let target: SentenceToPolish | null = null;

    if (explicitText && explicitText.trim().length > 0) {
      const trimmed = explicitText.trim();
      const loc = this.locateDocText(trimmed);
      target = {
        sentence: trimmed,
        from: loc ? loc.from : cursor,
        to: loc ? loc.to : cursor + trimmed.length,
        surroundingContext: docText.slice(Math.max(0, cursor - 100), Math.min(docText.length, cursor + 100)),
      };
    } else {
      // 1. Prefer user's active editor selection if available
      const selectedText = editor.getSelection();
      if (selectedText && selectedText.trim().length > 0) {
        const fromPos = editor.getCursor("from");
        const toPos = editor.getCursor("to");
        const fromOffset = editor.posToOffset(fromPos);
        const toOffset = editor.posToOffset(toPos);
        target = {
          sentence: selectedText.trim(),
          from: fromOffset,
          to: toOffset,
          surroundingContext: docText.slice(Math.max(0, fromOffset - 100), Math.min(docText.length, toOffset + 100)),
        };
      } else if (
        this.lastSelectedText &&
        Date.now() - this.lastSelectedTime < 10000 &&
        this.lastSelectedRange
      ) {
        // Fallback: user selected a sentence on mobile, but touching the panel dropped the native selection
        const from = this.lastSelectedRange.from;
        const to = this.lastSelectedRange.to;
        target = {
          sentence: this.lastSelectedText,
          from,
          to,
          surroundingContext: docText.slice(Math.max(0, from - 100), Math.min(docText.length, to + 100)),
        };
      } else {
        target = extractSentenceToPolish(docText, cursor);
      }
    }

    if (!target || target.sentence.length === 0) {
      new Notice("游標附近未偵測到需要潤飾的句子");
      return;
    }

    this.isPolishMode = true;
    this.isInquiryMode = false;
    this.currentInquiryItem = null;
    this.cardPanel?.clearPinnedInquiry();
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
        maxOutputTokens: 400,
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

      // NOTE: Do NOT automatically set ghost text in the editor!
      // The editor remains 100% clean until user explicitly clicks a card for shadow typing drill.
    } catch (e: any) {
      this.isPolishMode = false;
      this.currentPolishItem = null;
      this.cardPanel?.setError("⚠️ 潤飾失敗，請檢查 API Key 或網路");
      new Notice(`潤飾失敗：${e?.message || e}`);
    }
  }

  async handleInquiryPrompt() {
    const activeMarkdownView = this.getActiveMarkdownView();
    if (!activeMarkdownView || !activeMarkdownView.file) {
      new Notice("請先在筆記編輯器內操作");
      return;
    }

    forceDismissSoftKeyboard();
    this.cardPanel?.dismissSoftKeyboard();
    this.cardPanel?.openCards(true);

    if (!this.isEligibleNote(activeMarkdownView.file)) {
      this.manuallyEnabledNotes.add(activeMarkdownView.file.path);
      this.syncActiveView();
    }

    const editor = activeMarkdownView.editor;
    const docText = editor.getValue();
    const cursor = editor.posToOffset(editor.getCursor());

    const context = extractContextFromDoc(docText, cursor);
    if (!docText.trim()) {
      // 空白筆記：直接提供啟發性的今日訪談引導問句，讓使用者能看著題目開口說寫第一句話！
      const starterQuestions: InquiryItem[] = [
        {
          closedQuestion: "Did you encounter any memorable moment or unexpected challenge today?",
          closedChinese: "今天是否有遇到什麼難忘的時刻，或意想不到的挑戰？",
          openQuestion: "What was the most meaningful or memorable thing that happened to you today?",
          openChinese: "今天發生了什麼最有意義、或是最讓你印象深刻的事？",
          yes1: "Yes, something really special happened today that made my whole day.",
          yes2: "Actually yes, I had an unexpected conversation that changed my perspective.",
          no1: "Not really, today was pretty calm and followed my usual routine.",
          no2: "To be honest, it was just a quiet, low-key day without much drama.",
          openStyle1: "The most memorable thing was definitely catching up with an old friend.",
          openStyle2: "What struck me today was how much progress I've made on my personal goals.",
          openStyle3: "I found myself reflecting deeply on my priorities and what truly matters.",
          openStyle4: "Just taking a quiet walk this evening completely cleared my head.",
        },
        {
          closedQuestion: "Did someone or something surprise you in a pleasant way today?",
          closedChinese: "今天是否有人或事物帶給你意想不到的驚喜？",
          openQuestion: "Who did you spend the most time with today, and what did you talk about?",
          openChinese: "今天你花最多時間和誰在一起，你們聊了些什麼？",
          yes1: "Yes, I got a pleasant surprise from a friend that really brightened my mood.",
          yes2: "Surprisingly yes, things turned out much better than I had anticipated.",
          no1: "No surprises today, everything was quite predictable and straightforward.",
          no2: "Not really, it was just another regular working day for me.",
          openStyle1: "I spent most of my time discussing work projects with my colleagues.",
          openStyle2: "I had a heartwarming dinner conversation with my family about our plans.",
          openStyle3: "I spent quality time alone, reflecting and organizing my thoughts.",
          openStyle4: "I had a great chat with a mentor that gave me fresh inspiration.",
        },
      ];
      const randomStarter = starterQuestions[Math.floor(Math.random() * starterQuestions.length)];
      this.isInquiryMode = true;
      this.isPolishMode = false;
      this.currentInquiryItem = randomStarter;
      this.cardPanel?.setPinnedInquiry(randomStarter);
      new Notice("💭 已為您開啟今日日記問答引導！請在筆記中回答", 2500);
      return;
    }

    this.isInquiryMode = true;
    this.isPolishMode = false;
    this.cardPanel?.setLoading("❓ 正在根據日記內容構思是非與開放式引導問句...");
    this.clearGhostText();

    try {
      const systemPrompt = buildInquirySystemPrompt(this.settings.englishLevel, this.settings.diaryTone);
      const surrounding = context.recentSentences.join(" ") || docText.slice(Math.max(0, cursor - 300), cursor);
      const userPrompt = buildInquiryUserPrompt({
        surroundingContext: surrounding,
        currentSentence: context.currentSentence || "",
        englishLevel: this.settings.englishLevel,
        tone: this.settings.diaryTone,
      });

      const responseText = await this.llm.complete({
        systemPrompt,
        userPrompt,
        temperature: 0.7,
        maxOutputTokens: 600,
      });

      const parsed = parseInquiryResponse(responseText);
      if (!parsed || (!parsed.closedQuestion && !parsed.openQuestion)) {
        throw new Error("無法解析問句內容");
      }

      this.currentInquiryItem = parsed;
      this.cardPanel?.setPinnedInquiry(parsed);
      // NOTE: NEVER auto-display ghost text in editor! Keep editor 100% clean.
    } catch (e: any) {
      this.isInquiryMode = false;
      this.currentInquiryItem = null;
      this.cardPanel?.setError("⚠️ 提問生成失敗，請檢查 API Key 或網路");
      new Notice(`提問生成失敗：${e?.message || e}`);
    }
  }

  getEditorView(): EditorView | null {
    const activeMarkdownView = this.getActiveMarkdownView();
    if (!activeMarkdownView || !activeMarkdownView.editor) return this.currentActiveEditorView || null;
    // @ts-ignore
    const cm = (activeMarkdownView.editor as any).cm as EditorView;
    if (cm) {
      this.currentActiveEditorView = cm;
      return cm;
    }
    return this.currentActiveEditorView || null;
  }

  private setGhostText(text: string | null, anchorPos?: number) {
    const editorView = this.getEditorView();
    if (!editorView) return;
    if (!text) {
      this.clearGhostText();
      return;
    }
    const pos = anchorPos ?? editorView.state.selection.main.head;
    editorView.dispatch({
      effects: setGhostTextEffect.of({ targetText: text, anchorPos: pos }),
    });
  }

  private clearGhostText() {
    const editorView = this.getEditorView();
    if (!editorView) return;
    editorView.dispatch({
      effects: setGhostTextEffect.of(null),
    });
  }

  triggerCardAdopt(cardNumber: 1 | 2 | 3 | 4): boolean {
    const card = this.cardPanel?.getCardAt(cardNumber - 1);
    if (card && card.text) {
      const item = this.isPolishMode
        ? this.currentPolishItem
        : (this.cardPanel?.getCurrentItem() || this.scheduler.getCurrentSuggestion());
      this.adoptSuggestion(card.text, card.kind, item?.sourceRange, false);
      return true;
    }

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
    this.adoptSuggestion(text, kind, item.sourceRange, false);
    return true;
  }

  resolveDualContextSnap(
    doc: string,
    cursorOffset: number,
    selectionRange?: { from: number; to: number } | null
  ): { pos: number; formattedText: (text: string) => string } {
    let target = Math.max(0, Math.min(cursorOffset, doc.length));

    // 1. Explicit selection awareness: if user recently selected text within last 10s
    if (
      selectionRange &&
      selectionRange.to > selectionRange.from &&
      Date.now() - this.lastSelectedTime < 10000 &&
      selectionRange.to <= doc.length
    ) {
      target = selectionRange.to;
    } else {
      // 2. Semantic sentence boundary snap (Anti-fragment)
      if (target < doc.length) {
        const nextNewline = doc.indexOf("\n", target);
        const lineEnd = nextNewline === -1 ? doc.length : nextNewline;
        const lineSlice = doc.slice(target, lineEnd);

        // Look forward within the current line for sentence punctuation: . ! ? 。 ！ ？
        const punctMatch = lineSlice.match(/[.!?。！？]/);
        if (punctMatch && punctMatch.index !== undefined) {
          // Snap right after the sentence punctuation
          target = target + punctMatch.index + 1;
        } else {
          // If no punctuation on this line, check if cursor is inside a word
          const isPrevWord = target > 0 && /\w/.test(doc.charAt(target - 1));
          const isNextWord = target < doc.length && /\w/.test(doc.charAt(target));
          if (isPrevWord && isNextWord) {
            // Cursor is inside a word: snap forward to the end of this word
            const wordEndMatch = lineSlice.match(/^\w+/);
            if (wordEndMatch) {
              target = target + wordEndMatch[0].length;
            }
          }
        }
      }
    }

    // 3. Anti-Glue Guard (Double-sided whitespace & punctuation check)
    return {
      pos: target,
      formattedText: (text: string) => {
        const clean = text.trim();
        if (!clean) return "";

        const prevChar = target > 0 ? doc.charAt(target - 1) : "";
        const nextChar = target < doc.length ? doc.charAt(target) : "";

        // Needs leading space if preceding character is not whitespace and not a newline
        const needsLeadingSpace = prevChar.length > 0 && !/\s/.test(prevChar);

        // Needs trailing space if following character is not whitespace, not newline, and not punctuation
        const needsTrailingSpace =
          nextChar.length > 0 && !/\s/.test(nextChar) && !/[.!?,:;。！？，：；]/.test(nextChar);

        const prefix = needsLeadingSpace ? " " : "";
        const suffix = needsTrailingSpace ? " " : "";
        return `${prefix}${clean}${suffix}`;
      },
    };
  }

  adoptSuggestion(
    text: string,
    kind: "continue" | "alternative" | "translation",
    sourceRange?: { from: number; to: number },
    isDirectPaste = false,
    sourceChannel: "click" | "oral" | "keyboard" = "click"
  ) {
    const activeMarkdownView = this.getActiveMarkdownView();
    if (!activeMarkdownView || !activeMarkdownView.file) return;
    this.activeView = activeMarkdownView;

    const editorView = this.getEditorView();
    if (!editorView) return;

    let cleanText = text.trim();
    if (!cleanText) return;

    const editor = activeMarkdownView.editor;
    const docLength = editorView.state.doc.length;
    const fullDoc = editorView.state.doc.toString();

    // On desktop, refocus editor
    if (!Platform.isMobile) {
      editor.focus();
    }

    const currentCursor = editor.posToOffset(editor.getCursor());
    let targetPos = currentCursor;
    let replacedText = "";

    // Exit inquiry mode
    this.isInquiryMode = false;
    this.currentInquiryItem = null;

    let from = -1;
    let to = -1;

    // Replacement should ONLY occur in 3 specific situations:
    // 1. In Polish Mode: replacing the specific sentence that was polished
    if (this.isPolishMode && this.currentPolishItem) {
      const polishSource = this.currentPolishItem.translationSource?.trim();
      const pRange = this.currentPolishItem.sourceRange;

      if (pRange) {
        from = Math.min(pRange.from, pRange.to);
        to = Math.max(pRange.from, pRange.to);
      }

      // If text at pRange does not match polishSource, search ONLY in a local window around pRange / cursor, NEVER from index 0!
      if (polishSource && polishSource.length > 0) {
        const expected = fullDoc.slice(Math.max(0, from), Math.min(docLength, to)).trim();
        if (expected !== polishSource) {
          const anchor = (pRange && pRange.from >= 0) ? pRange.from : currentCursor;
          const searchStart = Math.max(0, anchor - 200);
          const searchEnd = Math.min(docLength, anchor + 200);
          const localSlice = fullDoc.slice(searchStart, searchEnd);
          const localIdx = localSlice.indexOf(polishSource);
          if (localIdx !== -1) {
            from = searchStart + localIdx;
            to = from + polishSource.length;
          }
        }
      }
    }
    // 2. Translation Mode: replacing Chinese segment
    else if (kind === "translation" && sourceRange) {
      from = Math.min(sourceRange.from, sourceRange.to);
      to = Math.max(sourceRange.from, sourceRange.to);
    }
    // 3. Explicit editor selection: replacing what user highlighted
    else {
      const selected = editor.getSelection();
      if (selected && selected.trim().length > 0) {
        const fromPos = editor.getCursor("from");
        const toPos = editor.getCursor("to");
        from = editor.posToOffset(fromPos);
        to = editor.posToOffset(toPos);
      }
    }

    // On mobile, ALWAYS use direct paste (never delete text for impossible ghost typing!)
    const shouldDirectPaste = isDirectPaste || Platform.isMobile;

    if (from >= 0 && to >= 0) {
      from = Math.max(0, Math.min(from, docLength));
      to = Math.max(0, Math.min(to, docLength));
      replacedText = editorView.state.doc.sliceString(from, to);

      if (shouldDirectPaste) {
        // Direct paste: replace sourceRange directly with cleanText!
        editorView.dispatch({
          changes: { from, to, insert: cleanText },
          selection: { anchor: from + cleanText.length },
          userEvent: "input",
        });
        targetPos = from + cleanText.length;
        this.isPolishMode = false;
        this.currentPolishItem = null;
        this.scheduler.clear();
        this.clearGhostText();
        this.cardPanel?.renderIdleState();
        if (Platform.isMobile) {
          this.cardPanel?.closeCards(false, true);
        }
        this.recordAdoption(cleanText, sourceChannel === "oral" ? "oral" : kind, replacedText);
        if (sourceChannel === "oral") {
          new Notice("🎉 語音跟讀成功！已自動替換筆記！", 2500);
        } else {
          new Notice("⚡ 已成功填入替換！", 1500);
        }
        return;
      } else {
        // Desktop shadow typing: delete the original sentence
        editorView.dispatch({
          changes: { from, to, insert: "" },
          selection: { anchor: from },
          userEvent: "delete",
        });
        targetPos = from;
        this.isPolishMode = false;
        this.currentPolishItem = null;
      }
    } else {
      // Scheme 3: Dual-Context Aware Snap for inserting new sentences (Continuation / Inquiry)
      const snap = this.resolveDualContextSnap(fullDoc, targetPos, this.lastSelectedRange);
      targetPos = snap.pos;
      const formattedInsert = snap.formattedText(cleanText);

      if (shouldDirectPaste) {
        // Direct paste: insert at snapped position with anti-glue formatting!
        editorView.dispatch({
          changes: { from: targetPos, to: targetPos, insert: formattedInsert },
          selection: { anchor: targetPos + formattedInsert.length },
          userEvent: "input",
        });
        this.scheduler.clear();
        this.clearGhostText();
        this.cardPanel?.renderIdleState();
        if (Platform.isMobile) {
          this.cardPanel?.closeCards(false, true);
        }
        this.recordAdoption(cleanText, sourceChannel === "oral" ? "oral" : kind);
        if (sourceChannel === "oral") {
          new Notice("🎉 語音跟讀成功！已自動套入筆記！", 2500);
        } else {
          new Notice("⚡ 已成功填入筆記！", 1500);
        }
        return;
      }

      // For desktop shadow typing: use formatted text as target
      cleanText = formattedInsert;
    }

    // Set cursor to target position
    editor.setCursor(editor.offsetToPos(targetPos));

    // Start shadow typing session for this chosen text at `targetPos`
    this.scheduler.startShadowTyping(cleanText, targetPos);
    this.setGhostText(cleanText, targetPos);

    // Record adoption along with the original replaced text
    this.recordAdoption(cleanText, kind, replacedText);

    new Notice(sourceRange ? "✍️ 已消除原文字，請跟寫練習！" : "✍️ 已套用建議，請跟寫練習！", 2000);
  }

  handleDirectPaste() {
    if (!this.scheduler.isShadowMode()) return;

    const targetText = this.scheduler.getShadowTargetText();
    const anchorPos = this.scheduler.getAnchorPos();
    if (!targetText) return;

    const activeMarkdownView = this.getActiveMarkdownView();
    if (!activeMarkdownView || !activeMarkdownView.file) return;

    const editorView = this.getEditorView();
    if (!editorView) return;

    const editor = activeMarkdownView.editor;
    const currentCursor = editor.posToOffset(editor.getCursor());

    // Replace anything typed since anchorPos with the full targetText!
    editorView.dispatch({
      changes: {
        from: anchorPos,
        to: Math.max(anchorPos, currentCursor),
        insert: targetText,
      },
      selection: { anchor: anchorPos + targetText.length },
      userEvent: "input",
    });

    // Clear shadow state & restore cards
    this.scheduler.clear();
    this.clearGhostText();
    this.cardPanel?.renderIdleState();
    if (Platform.isMobile) {
      this.cardPanel?.closeCards(false, true);
    }

    this.recordAdoption(targetText, "continue");
    new Notice("⚡ 已直接填入完整句子！", 1500);

    // Refetch next suggestions for continuation
    editor.focus();
    const newContext = extractContextFromDoc(editor.getValue(), anchorPos + targetText.length);
    const filePath = activeMarkdownView.file.path;
    const paragraphSummary = this.summaryManager.getParagraphSummary(filePath);
    const styleSummary = this.data.styleSummary?.summary;
    this.scheduler.handleDocChange(newContext, styleSummary, paragraphSummary);
  }

  executeOralAdoption(
    text: string,
    kind: "continue" | "alternative" | "translation",
    sourceRange?: { from: number; to: number }
  ) {
    const activeMarkdownView = this.getActiveMarkdownView();
    if (!activeMarkdownView || !activeMarkdownView.file) return;
    this.activeView = activeMarkdownView;

    // Use unified adoptSuggestion with direct paste = true and sourceChannel = "oral"
    this.adoptSuggestion(text, kind, sourceRange, true, "oral");
  }

  recordAdoption(text: string, kind: string, sourceText?: string) {
    if (!text || text.trim().length === 0) return;
    const todayDate = this.activeView?.file ? this.activeView.file.basename : new Date().toISOString().slice(0, 10);
    if (!this.data.adoptions[todayDate]) {
      this.data.adoptions[todayDate] = [];
    }
    this.data.adoptions[todayDate].push({
      text: text.trim(),
      kind: kind as any,
      source: sourceText && sourceText.trim().length > 0 ? sourceText.trim() : undefined,
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

  updateRibbonIcon() {
    const shouldShow = this.settings.showRibbonIcon ?? true;
    if (shouldShow) {
      if (!this.ribbonIconEl) {
        this.ribbonIconEl = this.addRibbonIcon("sparkles", "Diary Copilot (全域開啟／關閉)", () => {
          this.toggleCopilotGlobally();
        });
      }
      this.updateRibbonIconState();
    } else {
      if (this.ribbonIconEl) {
        this.ribbonIconEl.detach();
        this.ribbonIconEl = null;
      }
    }
  }

  private updateRibbonIconState() {
    if (!this.ribbonIconEl) return;
    if (this.isCopilotGloballyMuted) {
      this.ribbonIconEl.setAttribute("aria-label", "Diary Copilot (已全域關閉，點擊開啟)");
      this.ribbonIconEl.style.opacity = "0.45";
    } else {
      this.ribbonIconEl.setAttribute("aria-label", "Diary Copilot (已全域開啟，點擊關閉)");
      this.ribbonIconEl.style.opacity = "1";
    }
  }
}
