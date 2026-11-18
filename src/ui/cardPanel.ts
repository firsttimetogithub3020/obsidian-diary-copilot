import { Platform, Notice } from "obsidian";
import { SuggestionItem, DiaryTone, InquiryItem, EnglishLevel, CopilotMode } from "../types";
import { DIARY_TONE_OPTIONS, GEPT_LEVEL_OPTIONS } from "../settings";
import { speakSentence, stopAudio } from "../services/tts";
import { globalSpeechRecognizer, evaluateOralMatch, OralMatchResult } from "../services/speech";
import { VoiceStage } from "./voiceStage";

export interface CardPanelCallbacks {
  onAdopt: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }, isDirectPaste?: boolean) => void;
  onDismiss: () => void;
  onHeightResize?: (newHeight: number) => void;
  onToneChange?: (tone: DiaryTone) => void;
  getTone?: () => DiaryTone;
  onPolishRequest?: () => void;
  onInquiryRequest?: () => void;
  onClose?: () => void;
  onDirectPaste?: () => void;
  onUnlock?: () => void;
  onCheckUpdate?: () => void;
  onFontSizeChange?: (size: number) => void;
  getFontSize?: () => number;
  onCollapsedHeightChange?: (height: number) => void;
  getCollapsedHeight?: () => number;
  onOralStart?: () => void;
  onOralAdopt?: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onOralInput?: (spokenText: string, targetText: string) => void;
  onFocusEditor?: () => void;
  onDismissKeyboard?: () => void;
  onCardSelect?: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onInsertSpokenDraft?: (spokenText: string) => Promise<{ from: number; to: number; rawInserted: string }>;
  onAppendDiarySentence?: (
    sentence: string,
    draftInfo?: { from: number; to: number; sourceText: string; rawInserted: string },
    kind?: "continue" | "oral"
  ) => Promise<void>;
  getEditorSelection?: () => { text: string; from: number; to: number } | null;
  onLocateDocText?: (text: string) => { from: number; to: number } | null;
  onGetSentenceToPolish?: () => { text: string; from: number; to: number } | null;
  onOpenTodayDiary?: () => void;
  onTidyUpRequest?: () => void;
  onFullTextShadowingRequest?: () => void;
  getCopilotMode?: () => CopilotMode;
  onModeChange?: (mode: CopilotMode) => Promise<void>;
  getEnglishLevel?: () => EnglishLevel;
  onEnglishLevelChange?: (level: EnglishLevel) => void;
  getDiaryContext?: () => string;
  getLlmClient?: () => any;
}

interface CardDescriptor {
  title: string;
  shortcut: string;
  text: string;
  kind: "continue" | "alternative" | "translation";
  subText?: string | null;
}

export function forceDismissSoftKeyboard() {
  try {
    const activeEl = document.activeElement as HTMLElement;
    if (activeEl && typeof activeEl.blur === "function") {
      activeEl.blur();
    }
    const dummy = document.createElement("input");
    dummy.setAttribute("type", "text");
    dummy.setAttribute("readonly", "readonly");
    dummy.style.position = "fixed";
    dummy.style.top = "-9999px";
    dummy.style.left = "-9999px";
    dummy.style.opacity = "0";
    dummy.style.height = "0";
    dummy.style.width = "0";
    document.body.appendChild(dummy);
    dummy.focus();
    dummy.blur();
    dummy.remove();
  } catch (e) {
    // ignore
  }
}

export class CardPanel {
  private containerEl: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private statusDotEl: HTMLElement | null = null;
  private brandTextEl: HTMLElement | null = null;
  private headerHintEl: HTMLElement | null = null;
  private brandWrapperEl: HTMLElement | null = null;
  private headerAudioEl: HTMLElement | null = null;
  private headerCenterEl: HTMLElement | null = null;
  private toneWrapperEl: HTMLElement | null = null;
  private toneSelectEl: HTMLSelectElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private headerSysEl: HTMLElement | null = null;
  private contentAreaEl: HTMLElement | null = null;
  private resizeHandleEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private onWindowResize: (() => void) | null = null;
  private callbacks: CardPanelCallbacks;
  private currentItem: SuggestionItem | null = null;
  private isResizing = false;
  private isCollapsed = false;
  private isCardsExpanded = !Platform.isMobile;
  private foldBtnEl: HTMLElement | null = null;
  private activeTabIdx = 0;
  private currentCards: CardDescriptor[] = [];
  private isShadowTyping = false;

  // Inquiry Guided Mode State (Pinned Question Strip + Real-time Continuation Cards)
  private pinnedInquiryItem: InquiryItem | null = null;
  private pinnedInquiryCategory: "closed" | "open" = "closed";
  private isShowingInquiryAnswers = false;
  private hasUserManuallyResized = false;
  private userManualHeight: number | null = null;

  // Oral Shadowing Visual Studio State
  private isOralMode = false;
  private oralTargetText = "";
  private oralKind: "continue" | "alternative" | "translation" = "continue";
  private oralSourceRange?: { from: number; to: number };
  private oralPassed = false;
  private isOralListening = false;
  private oralLatestTranscript = "";
  private oralPassTimeout: number | null = null;
  private oralAutoFinalizeTimeout: number | null = null;
  private oralWorkspaceEl: HTMLElement | null = null;
  private oralTargetWordSpans: HTMLElement[] = [];
  private oralLiveTextEl: HTMLElement | null = null;
  private oralProgressFillEl: HTMLElement | null = null;
  private oralScoreBadgeEl: HTMLElement | null = null;
  private oralDockControlsEl: HTMLElement | null = null;
  private desktopVoiceInputEl: HTMLInputElement | null = null;
  private settingsMenuOverlayEl: HTMLElement | null = null;
  private settingsEscapeHandler: ((e: KeyboardEvent) => void) | null = null;

  // Mode state: "compact" (精簡模式: 問答引導 + 潤飾 + 整理跟讀, 零續寫干擾) | "full" (完整模式: 續寫卡片 + 接續鍵 + 提問 + 潤飾)
  private copilotMode: CopilotMode;
  private isVoiceStageActive: boolean;
  private voiceStage: VoiceStage | null = null;

  constructor(containerEl: HTMLElement, callbacks: CardPanelCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.copilotMode = this.callbacks.getCopilotMode?.() || "compact";
    this.isVoiceStageActive = false;
    this.render();
  }

  public async toggleCopilotMode() {
    this.copilotMode = this.copilotMode === "compact" ? "full" : "compact";
    this.isVoiceStageActive = false;
    await this.callbacks.onModeChange?.(this.copilotMode);
    this.resetToAutoFit();
    this.renderBrowseMode();
    new Notice(
      this.copilotMode === "compact"
        ? "⚡ 已切換至精簡模式（引導問答 ＋ 地道潤飾 ＋ 整理跟讀）"
        : "🌟 已切換至完整模式（即時續寫卡片 ＋ 接續鍵 ＋ 提問潤飾）",
      2500
    );
  }

  public setCopilotMode(mode: CopilotMode) {
    this.copilotMode = mode;
    this.isVoiceStageActive = false;
    this.resetToAutoFit();
    this.renderBrowseMode();
  }

  public hasPinnedInquiry(): boolean {
    return !!this.pinnedInquiryItem;
  }

  private render() {
    document.body.addClass("has-diary-copilot-active");
    this.panelEl = this.containerEl.createDiv({ cls: "diary-copilot-panel" });
    if (Platform.isMobile) {
      this.panelEl.addClass("is-mobile");
    }

    // Top resize handle bar
    this.resizeHandleEl = this.panelEl.createDiv({ cls: "diary-copilot-resize-handle" });
    this.setupResizeListeners();

    // Header bar (unified action bar across browse, locked, & oral modes)
    this.headerEl = this.panelEl.createDiv({ cls: "diary-copilot-panel-header" });
    this.headerEl.addEventListener("click", () => {
      if (this.isCollapsed) {
        this.resetToAutoFit();
      }
    });
    
    // Row 1 (Top Row): Brand & Tone (Left) + System Actions (Right)
    const row1 = this.headerEl.createDiv({ cls: "diary-copilot-header-row diary-copilot-header-row-1" });
    this.brandWrapperEl = row1.createDiv({ cls: "diary-copilot-brand-wrapper" });

    const brand = this.brandWrapperEl.createDiv({ cls: "diary-copilot-brand" });
    this.statusDotEl = brand.createSpan({ cls: "diary-copilot-status-dot" });
    this.brandTextEl = brand.createSpan({ cls: "diary-copilot-brand-text", text: "Diary Copilot" });

    // Tone Selector (visible in browse mode) in Brand Wrapper
    this.toneWrapperEl = this.brandWrapperEl.createDiv({ cls: "diary-copilot-tone-wrapper" });
    this.toneWrapperEl.createSpan({ cls: "diary-copilot-tone-label", text: "語調：" });

    this.toneSelectEl = this.toneWrapperEl.createEl("select", { cls: "diary-copilot-tone-select" });
    const currentTone = this.callbacks.getTone?.() || "casual";

    for (const opt of DIARY_TONE_OPTIONS) {
      const optionEl = this.toneSelectEl.createEl("option", {
        value: opt.id,
        text: opt.label,
      });
      if (opt.id === currentTone) {
        optionEl.selected = true;
      }
    }

    this.toneSelectEl.addEventListener("change", (e) => {
      const newTone = (e.target as HTMLSelectElement).value as DiaryTone;
      this.callbacks.onToneChange?.(newTone);
    });

    // System Actions Bar (Row 1 Right): 🔄 檢查更新, ✕ 關閉
    this.headerSysEl = row1.createDiv({ cls: "diary-copilot-header-sys" });

    // Row 2 (Bottom Row): Audio (Left) + Center Space + Main Actions (Right)
    const row2 = this.headerEl.createDiv({ cls: "diary-copilot-header-row diary-copilot-header-row-2" });
    this.headerAudioEl = row2.createDiv({ cls: "diary-copilot-header-audio" });
    this.headerCenterEl = row2.createDiv({ cls: "diary-copilot-header-center" });
    this.headerActionsEl = row2.createDiv({ cls: "diary-copilot-header-actions" });

    // Content Area
    this.contentAreaEl = this.panelEl.createDiv({ cls: "diary-copilot-panel-content" });

    this.updateHeaderLayout();
    this.renderIdleState();
    this.updateStatusBarOffset();
    window.setTimeout(() => this.updateStatusBarOffset(), 400);
  }

  public updateStatusBarOffset() {
    if (Platform.isMobile) return;
    // Desktop layout: full-width balanced alignment without artificial right squeeze
    this.panelEl?.style.setProperty("--diary-copilot-status-bar-offset", "0px");
  }

  private setupResizeListeners() {
    if (!this.resizeHandleEl) return;
    const handleEl = this.resizeHandleEl;
    handleEl.setAttribute("title", "拖曳調整高度 · 按一下收摺/展開 · 點按功能自動貼合內容");

    let pointerStartY = 0;
    let pointerStartTime = 0;
    let initialHeight = 125;
    let pointerMoved = false;

    // Modern Unified Pointer Events: Works seamlessly across Mobile Touch (Android / iOS) and Desktop Mouse
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      this.isResizing = true;
      pointerMoved = false;
      pointerStartY = e.clientY;
      pointerStartTime = Date.now();
      initialHeight = this.panelEl ? this.panelEl.offsetHeight : 125;

      this.panelEl?.addClass("is-resizing");
      try {
        handleEl.setPointerCapture(e.pointerId);
      } catch {}

      // CRITICAL: preventDefault keeps editor focused so soft keyboard never dismisses on mobile!
      e.preventDefault();
      e.stopPropagation();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.isResizing || !this.panelEl) return;
      e.preventDefault();
      e.stopPropagation();

      const deltaY = pointerStartY - e.clientY; // Upward drag increases height, downward decreases height
      const minH = Platform.isMobile ? 60 : 46;
      const clampedHeight = Math.max(minH, Math.min(initialHeight + deltaY, window.innerHeight * 0.75));

      if (Math.abs(deltaY) > 3) {
        pointerMoved = true;
        this.hasUserManuallyResized = true;
        this.isCollapsed = false;
        this.panelEl?.removeClass("is-collapsed");
        if (clampedHeight > (Platform.isMobile ? 75 : 60)) {
          this.panelEl?.removeClass("is-compact-idle");
          this.panelEl?.removeClass("is-keyboard-writing");
        }
      }

      this.panelEl.style.height = `${clampedHeight}px`;
      if (clampedHeight <= 95) {
        this.panelEl.addClass("is-compact");
      } else {
        this.panelEl.removeClass("is-compact");
      }
      document.body.style.setProperty("--diary-copilot-panel-height", `${clampedHeight}px`);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.isResizing || !this.panelEl) return;
      this.isResizing = false;
      this.panelEl.removeClass("is-resizing");
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}

      const elapsed = Date.now() - pointerStartTime;

      // Quick tap (< 350ms without moving): One-tap Toggle Fold / Expand on BOTH Mobile & Desktop!
      if (!pointerMoved && elapsed < 350) {
        this.toggleFoldCards();
        return;
      }

      if (pointerMoved) {
        const finalHeight = parseInt(this.panelEl.style.height, 10);
        const minH = Platform.isMobile ? 60 : 46;
        if (!isNaN(finalHeight) && finalHeight >= minH) {
          this.hasUserManuallyResized = true;
          this.userManualHeight = finalHeight;
          if (finalHeight <= minH + 15) {
            this.panelEl.addClass("is-compact");
            if (this.copilotMode === "compact" && this.currentCards.length === 0) {
              this.panelEl.addClass("is-compact-idle");
            }
          } else {
            this.panelEl.removeClass("is-compact");
            this.panelEl.removeClass("is-compact-idle");
            this.panelEl.removeClass("is-keyboard-writing");
          }
          this.callbacks.onHeightResize?.(finalHeight);
        }
      }
    };

    handleEl.addEventListener("pointerdown", onPointerDown, { passive: false });
    handleEl.addEventListener("pointermove", onPointerMove, { passive: false });
    handleEl.addEventListener("pointerup", onPointerUp, { passive: false });
    handleEl.addEventListener("pointercancel", (e: PointerEvent) => {
      if (!this.isResizing || !this.panelEl) return;
      this.isResizing = false;
      this.panelEl.removeClass("is-resizing");
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}
    });

    handleEl.addEventListener("dblclick", (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.resetToAutoFit();
    });

    // Setup ResizeObserver & Orientation Listener for 2-row adaptive header
    if (this.panelEl && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.updateHeaderLayout();
      });
      this.resizeObserver.observe(this.panelEl);
    }

    this.onWindowResize = () => {
      this.updateHeaderLayout();
    };
    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("orientationchange", this.onWindowResize);
    this.setupKeyboardListeners();
  }

  private lastIsNarrowScreen: boolean | null = null;

  public isNarrowHeader(): boolean {
    if (Platform.isPhone || Platform.isMobile) return true;
    const width = this.panelEl?.clientWidth || window.innerWidth;
    return width < 600;
  }

  /**
   * Adapts header layout:
   * When on narrow phones, vertical/portrait orientation, or panel width < 720px,
   * automatically displays as two lines so no buttons are covered or pushed off-screen.
   */
  private updateHeaderLayout() {
    if (!this.headerEl || !this.panelEl) return;
    const width = this.panelEl.clientWidth || window.innerWidth;
    const height = window.innerHeight;
    const screenW = window.screen?.width || window.innerWidth;
    const screenH = window.screen?.height || window.innerHeight;
    const isPortrait = window.matchMedia?.("(orientation: portrait)").matches || (screenH > screenW) || (height > width);
    const isNarrow = width < 900;
    const isMobile = Platform.isMobile;

    const shouldBeTwoRow = isMobile || isPortrait || isNarrow;

    if (shouldBeTwoRow) {
      this.headerEl.addClass("is-two-row");
      this.panelEl.addClass("has-two-row-header");
    } else {
      this.headerEl.removeClass("is-two-row");
      this.panelEl.removeClass("has-two-row-header");
    }

    const isCompactHeader = this.isNarrowHeader();
    if (isCompactHeader) {
      this.headerEl.addClass("is-narrow-screen");
      this.panelEl.addClass("is-narrow-screen");
    } else {
      this.headerEl.removeClass("is-narrow-screen");
      this.panelEl.removeClass("is-narrow-screen");
    }

    if (this.lastIsNarrowScreen !== null && this.lastIsNarrowScreen !== isCompactHeader) {
      this.lastIsNarrowScreen = isCompactHeader;
      // Re-render header actions with updated button text
      this.renderHeaderActionsBrowse();
    } else {
      this.lastIsNarrowScreen = isCompactHeader;
    }
  }

  private onVisualViewportChange: (() => void) | null = null;
  private isKeyboardWriting = false;
  private isDismissingKeyboard = false;

  public updateFoldButtonState() {
    if (!this.foldBtnEl) return;
    const areCardsShowing = this.isCardsExpanded && 
      !this.isCollapsed && 
      !this.panelEl.hasClass("is-cards-closed") && 
      !this.panelEl.hasClass("is-keyboard-writing") && 
      !this.panelEl.hasClass("is-compact-idle");

    const isNarrow = this.isNarrowHeader();

    if (areCardsShowing) {
      this.foldBtnEl.className = "diary-copilot-action-btn diary-copilot-fold-toggle-btn is-expanded";
      this.foldBtnEl.setText(isNarrow ? "🔽 關閉" : (Platform.isDesktop ? "🔽 關閉字卡 (Esc)" : "🔽 關閉字卡"));
      this.foldBtnEl.setAttribute("aria-label", "關閉建議字卡 (Esc)");
      this.foldBtnEl.setAttribute("title", "關閉建議字卡 (Esc)");
    } else {
      this.foldBtnEl.className = "diary-copilot-action-btn diary-copilot-fold-toggle-btn is-folded";
      this.foldBtnEl.setText(isNarrow ? "📖 展開" : (Platform.isDesktop ? "📖 展開字卡 (Esc)" : "📖 展開字卡"));
      this.foldBtnEl.setAttribute("aria-label", "展開建議字卡 (Esc)");
      this.foldBtnEl.setAttribute("title", "展開建議字卡 (Esc)");
    }
  }

  private setupKeyboardListeners() {
    if (typeof window === "undefined") return;

    // 1. Capture focusin: When user places cursor inside editor/contentEditable (keyboard appearing)
    document.addEventListener("focusin", (e: FocusEvent) => {
      if (!Platform.isMobile) return;
      if (this.isDismissingKeyboard) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (this.panelEl && this.panelEl.contains(target)) return;
      if (target.closest(".cm-editor, .cm-content, [contenteditable='true'], textarea, input")) {
        // Cursor placed in editor to type -> close cards
        this.closeCards(true);
      }
    }, true);

    // 2. Viewport and window resize detection: Virtual keyboard open/close
    const handleViewportCheck = () => {
      if (!Platform.isMobile) return;
      if (this.isDismissingKeyboard) return;
      const screenH = window.screen?.height || window.innerHeight;
      const innerH = window.innerHeight;
      const vvH = window.visualViewport ? window.visualViewport.height : innerH;

      // In Android WebView and iOS, keyboard is open when innerH or visualViewport drops significantly below screen height
      const isKeyboardOpen = (innerH < screenH * 0.72) || (vvH < screenH * 0.72) || (window.visualViewport && window.visualViewport.height < window.innerHeight * 0.78);

      if (isKeyboardOpen) {
        if (!this.isKeyboardWriting || this.isCardsExpanded) {
          this.closeCards(true);
        }
      } else {
        if (this.isKeyboardWriting) {
          this.isKeyboardWriting = false;
          this.panelEl?.removeClass("is-keyboard-writing");
          this.updateFoldButtonState();
        }
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleViewportCheck);
      window.visualViewport.addEventListener("scroll", handleViewportCheck);
    }
    window.addEventListener("resize", handleViewportCheck);
  }

  public dismissSoftKeyboard() {
    this.isDismissingKeyboard = true;
    forceDismissSoftKeyboard();
    try {
      this.callbacks.onDismissKeyboard?.();
    } catch {}
    window.setTimeout(() => {
      this.isKeyboardWriting = false;
      this.panelEl?.removeClass("is-keyboard-writing");
      this.updateFoldButtonState();
      this.isDismissingKeyboard = false;
    }, 450);
  }

  public openCards(silent = false) {
    if (!this.panelEl) return;
    this.dismissSoftKeyboard();
    this.isCardsExpanded = true;
    this.isCollapsed = false;
    this.isKeyboardWriting = false;
    this.hasUserManuallyResized = false;
    this.panelEl.removeClass("is-cards-closed");
    this.panelEl.removeClass("is-keyboard-writing");
    this.panelEl.removeClass("is-collapsed");
    this.panelEl.removeClass("is-compact-idle");
    this.panelEl.removeClass("is-compact");

    this.applyPanelHeight();
    this.updateFoldButtonState();
    if (!silent) {
      new Notice("📖 已展開字卡", 1000);
    }
  }

  public getCollapsedHeight(): string {
    const baseHeight = this.callbacks.getCollapsedHeight?.() || 60;
    if (Platform.isMobile) {
      return `calc(${baseHeight}px + env(safe-area-inset-bottom, 0px))`;
    }
    return `${baseHeight}px`;
  }

  public closeCards(forKeyboard = false, silent = false) {
    if (!this.panelEl) return;
    this.isCardsExpanded = false;
    this.isCollapsed = true;
    if (forKeyboard) {
      this.isKeyboardWriting = true;
      this.panelEl.addClass("is-keyboard-writing");
    }
    this.panelEl.addClass("is-cards-closed");
    this.panelEl.addClass("is-collapsed");
    this.panelEl.addClass("is-compact");
    this.panelEl.addClass("is-compact-idle");

    const collapsedHeight = this.getCollapsedHeight();
    this.panelEl.style.height = collapsedHeight;
    document.body.style.setProperty("--diary-copilot-panel-height", collapsedHeight);

    this.updateFoldButtonState();
    if (!forKeyboard && !silent) {
      new Notice("🔽 已關閉字卡", 1000);
    }
  }

  public toggleFoldCards() {
    if (!this.panelEl) return;
    if (this.isOralMode) {
      this.cancelOralShadowing();
      this.closeCards(false);
      return;
    }
    const areCardsShowing = this.isCardsExpanded && 
      !this.isCollapsed && 
      !this.panelEl.hasClass("is-cards-closed") && 
      !this.panelEl.hasClass("is-keyboard-writing") && 
      !this.panelEl.hasClass("is-compact-idle");

    if (areCardsShowing) {
      this.closeCards(false);
    } else {
      this.openCards();
    }
  }

  /**
   * Applies either auto-fit height (hugs rendered content naturally), manual lock height, or collapsed height
   */
  public applyPanelHeight() {
    if (!this.panelEl) return;
    this.updateStatusBarOffset();

    if (this.isKeyboardWriting || !this.isCardsExpanded || this.panelEl.hasClass("is-cards-closed") || this.isCollapsed) {
      const collapsedHeight = this.getCollapsedHeight();
      this.panelEl.style.height = collapsedHeight;
      this.panelEl.addClass("is-compact");
      this.panelEl.addClass("is-collapsed");
      this.panelEl.addClass("is-cards-closed");
      this.panelEl.addClass("is-compact-idle");
      if (this.isKeyboardWriting) {
        this.panelEl.addClass("is-keyboard-writing");
      }
      document.body.style.setProperty("--diary-copilot-panel-height", collapsedHeight);
      this.updateFoldButtonState();
      return;
    }

    // In compact mode with no cards, no inquiry, and not loading (idle single-row toolbar)
    if (this.copilotMode === "compact" && this.currentCards.length === 0 && !this.pinnedInquiryItem && !this.hasUserManuallyResized && !this.panelEl.hasClass("is-loading")) {
      const compactBarHeight = this.getCollapsedHeight();
      this.panelEl.style.height = compactBarHeight;
      this.panelEl.addClass("is-compact");
      this.panelEl.addClass("is-compact-idle");
      document.body.style.setProperty("--diary-copilot-panel-height", compactBarHeight);
      this.updateFoldButtonState();
      return;
    }

    // When cards or inquiries are present:
    this.panelEl.removeClass("is-compact-idle");
    this.panelEl.removeClass("is-cards-closed");
    this.panelEl.removeClass("is-collapsed");

    // When Voice Stage is active on mobile
    if (this.isVoiceStageActive && Platform.isMobile && !this.hasUserManuallyResized) {
      const hasCards = this.voiceStage?.hasCards() || false;
      const targetHeight = hasCards
        ? Math.min(Math.round(window.innerHeight * 0.55), 390)
        : Math.min(Math.round(window.innerHeight * 0.42), 290);

      this.panelEl.style.height = `${targetHeight}px`;
      this.panelEl.removeClass("is-compact");
      this.panelEl.removeClass("is-collapsed");
      document.body.style.setProperty("--diary-copilot-panel-height", `${targetHeight}px`);
      this.updateFoldButtonState();
      return;
    }

    // Mobile standard cards view
    if (Platform.isMobile && !this.hasUserManuallyResized) {
      const targetHeight = Math.min(Math.round(window.innerHeight * 0.55), 390);
      this.panelEl.style.height = `${targetHeight}px`;
      this.panelEl.removeClass("is-compact");
      this.panelEl.removeClass("is-collapsed");
      document.body.style.setProperty("--diary-copilot-panel-height", `${targetHeight}px`);
      this.updateFoldButtonState();
      return;
    }

    if (this.hasUserManuallyResized && this.userManualHeight) {
      this.panelEl.style.height = `${this.userManualHeight}px`;
      if (this.userManualHeight <= 95) {
        this.panelEl.addClass("is-compact");
      } else {
        this.panelEl.removeClass("is-compact");
      }
      document.body.style.setProperty("--diary-copilot-panel-height", `${this.userManualHeight}px`);
    } else {
      this.panelEl.style.height = "auto";
      requestAnimationFrame(() => {
        if (!this.panelEl || this.hasUserManuallyResized || this.isCollapsed) return;
        const measured = this.panelEl.offsetHeight;
        if (measured > 0) {
          document.body.style.setProperty("--diary-copilot-panel-height", `${measured}px`);
          if (measured <= 95) {
            this.panelEl.addClass("is-compact");
          } else {
            this.panelEl.removeClass("is-compact");
          }
        }
      });
    }
    this.updateFoldButtonState();
  }

  /**
   * Resets manual lock and automatically fits the current rendered content height
   */
  public resetToAutoFit() {
    this.isCollapsed = false;
    this.hasUserManuallyResized = false;
    this.userManualHeight = null;
    this.panelEl?.removeClass("is-collapsed");
    this.panelEl?.removeClass("is-cards-closed");
    this.applyPanelHeight();
  }

  /**
   * Toggles between Collapsed (Header-only ~32px) and Expanded (Content-fit auto height)
   */
  public toggleCollapse() {
    this.toggleFoldCards();
  }

  renderIdleState(message?: string) {
    if (!this.panelEl || !this.contentAreaEl) return;
    this.contentAreaEl.empty();
    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");

    this.isOralMode = false;
    this.isShadowTyping = false;
    globalSpeechRecognizer.stop();

    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot is-idle";
    }
    if (this.brandTextEl) {
      this.brandTextEl.setText("Diary Copilot");
    }
    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = (this.copilotMode === "compact" || this.pinnedInquiryItem) ? "none" : "flex";
    }

    this.renderHeaderActionsBrowse();

    if (this.copilotMode !== "compact") {
      const empty = this.contentAreaEl.createDiv({ cls: "diary-copilot-empty-state" });
      empty.createSpan({ text: message || "✍️ 在上方筆記開始書寫英語，Copilot 將即時提供地道建議與跟寫練習..." });
    }
    this.applyPanelHeight();
  }

  setLoading(message = "思考地道表達中...") {
    if (!this.panelEl || !this.contentAreaEl) return;
    this.isCollapsed = false;
    this.isCardsExpanded = true;
    this.hasUserManuallyResized = false;
    this.dismissSoftKeyboard();
    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-collapsed");
    this.panelEl.removeClass("is-cards-closed");
    this.panelEl.removeClass("is-compact-idle");
    this.panelEl.removeClass("is-compact");
    this.panelEl.addClass("is-loading");

    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot is-thinking";
    }
    if (this.brandTextEl) {
      this.brandTextEl.setText(message);
    }
    this.applyPanelHeight();
    this.updateFoldButtonState();
  }

  setError(message = "⚠️ 連線異常或尚未設定 API Key") {
    if (!this.panelEl || !this.contentAreaEl) return;
    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");

    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot is-error";
    }
    if (this.brandTextEl) {
      this.brandTextEl.setText("連線提示");
    }
    this.renderIdleState(message);
  }

  getCurrentItem(): SuggestionItem | null {
    return this.currentItem;
  }

  setTone(tone: DiaryTone) {
    if (this.toneSelectEl) {
      this.toneSelectEl.value = tone;
    }
  }

  updateSuggestions(item: SuggestionItem | null, isPolishMode = false) {
    this.currentItem = item;
    if (!this.panelEl || !this.contentAreaEl) return;

    // When user types in editor, switch inquiry answers view back to real-time continuations
    if (!isPolishMode && this.isShowingInquiryAnswers) {
      this.isShowingInquiryAnswers = false;
    }

    // If currently actively in oral mode, don't clobber unless dismissed
    if (this.isOralMode) {
      return;
    }

    if (!this.pinnedInquiryItem && (!item || (!item.card1 && !item.card2 && !item.card3 && !item.card4 && !item.continueText))) {
      this.renderIdleState();
      return;
    }

    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }

    const c1 = item?.card1 || item?.continueText || "";
    const c2 = item?.card2 || item?.alternativeText || "";
    const c3 = item?.card3 || item?.translationText || "";
    const c4 = item?.card4 || "";

    const hasChineseSource = !!(item?.sourceRange && item?.translationSource);
    const isShadow = !isPolishMode && !hasChineseSource && !c2 && !c3 && !c4 && !!c1 && !this.pinnedInquiryItem;

    this.isShadowTyping = isShadow;

    if (isShadow) {
      // Locked Shadowing Mode (Oral & Typing Drill)
      this.renderLockedMode(c1);
      return;
    }

    this.renderBrowseMode();

    if (isPolishMode) {
      this.openCards(true);
    }
  }

  setPinnedInquiry(item: InquiryItem) {
    if (!this.panelEl || !this.contentAreaEl) return;
    this.pinnedInquiryItem = item;
    this.pinnedInquiryCategory = "closed";
    this.isShowingInquiryAnswers = true;
    this.activeTabIdx = 0;
    this.hasUserManuallyResized = false;
    this.isCollapsed = false;
    this.isCardsExpanded = true;

    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");
    this.panelEl.removeClass("is-collapsed");
    this.panelEl.removeClass("is-cards-closed");
    this.panelEl.removeClass("is-compact-idle");
    this.panelEl.removeClass("is-compact");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }

    this.renderBrowseMode();
    this.openCards(true);
  }

  updateInquiry(item: InquiryItem) {
    this.setPinnedInquiry(item);
  }

  clearPinnedInquiry() {
    this.pinnedInquiryItem = null;
    this.isShowingInquiryAnswers = false;
    this.resetToAutoFit();
    this.renderBrowseMode();
  }

  getCardAt(idx: number): CardDescriptor | null {
    return this.currentCards[idx] || null;
  }

  /**
   * Render Option A Browse Mode: Full-width Hero Card + Capsule Tabs (or 2x2 Desktop Grid)
   */
  private renderBrowseMode() {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    this.isOralMode = false;
    this.isShadowTyping = false;
    globalSpeechRecognizer.stop();

    // 1. Update brand text & tone display
    if (this.pinnedInquiryItem) {
      if (this.brandTextEl) {
        this.brandTextEl.setText("❓ 提問引導模式");
      }
      if (this.toneWrapperEl) {
        this.toneWrapperEl.style.display = "none";
      }
    } else {
      if (this.brandTextEl) {
        this.brandTextEl.setText("Diary Copilot");
      }
      if (this.toneWrapperEl) {
        this.toneWrapperEl.style.display = "flex";
      }
    }

    // 2. Build currentCards
    this.currentCards = [];
    const item = this.currentItem;

    if (this.isShowingInquiryAnswers && this.pinnedInquiryItem) {
      // Show AI's 4 suggested answers for the pinned question
      const inq = this.pinnedInquiryItem;
      const isClosed = this.pinnedInquiryCategory === "closed";
      if (isClosed) {
        if (inq.yes1) this.currentCards.push({ title: "🟢 Yes · 自然口語", shortcut: "Alt+1", text: inq.yes1, kind: "continue" });
        if (inq.yes2) this.currentCards.push({ title: "🟢 Yes · 細膩表達", shortcut: "Alt+2", text: inq.yes2, kind: "continue" });
        if (inq.no1) this.currentCards.push({ title: "🔴 No · 自然口語", shortcut: "Alt+3", text: inq.no1, kind: "continue" });
        if (inq.no2) this.currentCards.push({ title: "🔴 No · 細膩表達", shortcut: "Alt+4", text: inq.no2, kind: "continue" });
      } else {
        if (inq.openStyle1) this.currentCards.push({ title: "🌿 自然口語", shortcut: "Alt+1", text: inq.openStyle1, kind: "continue" });
        if (inq.openStyle2) this.currentCards.push({ title: "💭 情感反思", shortcut: "Alt+2", text: inq.openStyle2, kind: "continue" });
        if (inq.openStyle3) this.currentCards.push({ title: "💼 專業嚴謹", shortcut: "Alt+3", text: inq.openStyle3, kind: "continue" });
        if (inq.openStyle4) this.currentCards.push({ title: "⚡ 精簡有力", shortcut: "Alt+4", text: inq.openStyle4, kind: "continue" });
      }
    } else if (item) {
      // Show real-time continuation / translation / polish cards
      const c1 = item.card1 || item.continueText || "";
      const c2 = item.card2 || item.alternativeText || "";
      const c3 = item.card3 || item.translationText || "";
      const c4 = item.card4 || "";
      const hasChineseSource = !!(item.sourceRange && item.translationSource);

      if (hasChineseSource) {
        if (c1) this.currentCards.push({ title: "卡 1 · 自然口語", shortcut: "Alt+1", text: c1, kind: "translation", subText: `消除：${item.translationSource}` });
        if (c2) this.currentCards.push({ title: "卡 2 · 地道片語", shortcut: "Alt+2", text: c2, kind: "translation", subText: `消除：${item.translationSource}` });
        if (c3) this.currentCards.push({ title: "卡 3 · 精煉簡潔", shortcut: "Alt+3", text: c3, kind: "translation", subText: `消除：${item.translationSource}` });
        if (c4) this.currentCards.push({ title: "卡 4 · 換種句式", shortcut: "Alt+4", text: c4, kind: "translation", subText: `消除：${item.translationSource}` });
      } else {
        if (c1) this.currentCards.push({ title: "卡 1 · 自然口語", shortcut: "Alt+1", text: c1, kind: "continue" });
        if (c2) this.currentCards.push({ title: "卡 2 · 內心感受", shortcut: "Alt+2", text: c2, kind: "alternative" });
        if (c3) this.currentCards.push({ title: "卡 3 · 細節展開", shortcut: "Alt+3", text: c3, kind: "alternative" });
        if (c4) this.currentCards.push({ title: "卡 4 · 地道片語", shortcut: "Alt+4", text: c4, kind: "alternative" });
      }
    }

    if (this.activeTabIdx >= this.currentCards.length) {
      this.activeTabIdx = 0;
    }

    // 3. Render Header Actions
    this.renderHeaderActionsBrowse();

    if (Platform.isMobile) {
      this.dismissSoftKeyboard();
    }

    if (!this.pinnedInquiryItem && this.currentCards.length === 0) {
      this.renderIdleState();
      return;
    }

    // 4. If Pinned Inquiry exists, render the persistent question strip
    if (this.pinnedInquiryItem) {
      this.renderPinnedInquiryStrip();
    }

    // 5. Render Cards
    if (this.currentCards.length === 0) {
      const placeholder = this.contentAreaEl.createDiv({ cls: "diary-copilot-inquiry-hero-prompt" });
      placeholder.setText("✍️ 根據上方問題，在筆記中寫下回答，即時續寫將在此呈現...（或點擊上方「💡 查看建議回答」展開範例）");
      this.applyPanelHeight();
      return;
    }

    const isWideScreen = (this.contentAreaEl.clientWidth || window.innerWidth) >= 640;

    if (isWideScreen && this.currentCards.length > 1) {
      // DESKTOP & TABLET (iPad, Android Tablet, PC): 2x2 Clean Grid Layout with complete wrapped sentences!
      this.renderDesktop2x2Grid();
    } else {
      // PHONE (iPhone, Android Phone) & NARROW SPLIT: Single Card with Bottom Capsule Tabs (NO swipe gestures!)
      this.renderMobileSingleCard();
    }

    this.applyPanelHeight();
  }

  private renderVoiceStage() {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    if (this.brandTextEl) {
      this.brandTextEl.setText("🎙️ 口說對話舞台");
    }
    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = (Platform.isPhone || window.innerWidth < 640) ? "none" : "flex";
    }

    this.renderHeaderActionsBrowse();

    const llm = this.callbacks.getLlmClient?.();
    if (!llm) {
      const empty = this.contentAreaEl.createDiv({ cls: "diary-copilot-empty-state" });
      empty.createSpan({ text: "⚠️ LLM 尚未就緒，請檢查 Gemini API Key 設定" });
      this.applyPanelHeight();
      return;
    }

    this.voiceStage = new VoiceStage(this.contentAreaEl, llm, {
      onInsertSpokenDraft: async (spokenText: string) => {
        if (this.callbacks.onInsertSpokenDraft) {
          return await this.callbacks.onInsertSpokenDraft(spokenText);
        }
        return { from: 0, to: 0, rawInserted: "" };
      },
      onAppendSentence: async (sentence: string, draftInfo?: { from: number; to: number; sourceText: string; rawInserted: string }, kind?: "continue" | "oral") => {
        await this.callbacks.onAppendDiarySentence?.(sentence, draftInfo, kind);
      },
      onTidyUp: () => {
        this.callbacks.onTidyUpRequest?.();
      },
      onFullTextShadowing: () => {
        this.callbacks.onFullTextShadowingRequest?.();
      },
      onSwitchToClassic: () => {
        this.toggleVoiceStage();
      },
      getEnglishLevel: () => {
        return this.callbacks.getEnglishLevel?.() || "upper-intermediate";
      },
      getTone: () => {
        return this.callbacks.getTone?.() || "casual";
      },
      getDiaryContext: () => {
        return this.callbacks.getDiaryContext?.() || "";
      },
      getEditorSelection: () => {
        return this.callbacks.getEditorSelection?.() || null;
      },
      onGetSentenceToPolish: () => {
        return this.callbacks.onGetSentenceToPolish?.() || null;
      },
      onLocateDocText: (text: string) => {
        return this.callbacks.onLocateDocText?.(text) || null;
      },
      onCardRenderChange: () => {
        this.applyPanelHeight();
      },
    });

    this.voiceStage.render();
    this.applyPanelHeight();
  }

  public toggleVoiceStage() {
    this.isVoiceStageActive = !this.isVoiceStageActive;
    this.resetToAutoFit();
    this.renderBrowseMode();
  }

  public isVoiceActive(): boolean {
    return this.isVoiceStageActive;
  }

  /**
   * Pinned Question Strip: Keeps inquiry question anchored while user writes, with category & answer toggles
   */
  private renderPinnedInquiryStrip() {
    if (!this.contentAreaEl || !this.pinnedInquiryItem) return;
    const item = this.pinnedInquiryItem;
    const isClosed = this.pinnedInquiryCategory === "closed";
    const qText = isClosed ? item.closedQuestion : item.openQuestion;
    const qZh = (isClosed ? item.closedChinese : item.openChinese) || "";

    const stripEl = this.contentAreaEl.createDiv({ cls: "diary-copilot-pinned-inquiry-strip" });

    // Top control row
    const ctrlRow = stripEl.createDiv({ cls: "diary-copilot-pinned-inquiry-ctrls" });

    // Left: Category switcher
    const catGroup = ctrlRow.createDiv({ cls: "diary-copilot-pinned-cat-group" });
    const closedBtn = catGroup.createEl("button", {
      cls: `diary-copilot-pinned-cat-btn ${isClosed ? "is-active" : ""}`,
      text: "❓ 是非 (Yes/No)",
    });
    closedBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.pinnedInquiryCategory !== "closed") {
        this.pinnedInquiryCategory = "closed";
        this.activeTabIdx = 0;
        this.resetToAutoFit();
        this.renderBrowseMode();
      }
    });

    const openBtn = catGroup.createEl("button", {
      cls: `diary-copilot-pinned-cat-btn ${!isClosed ? "is-active" : ""}`,
      text: "💭 開放 (Wh-)",
    });
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.pinnedInquiryCategory !== "open") {
        this.pinnedInquiryCategory = "open";
        this.activeTabIdx = 0;
        this.resetToAutoFit();
        this.renderBrowseMode();
      }
    });

    // Right: Listen, toggle answers & dismiss strip
    const actionGroup = ctrlRow.createDiv({ cls: "diary-copilot-pinned-action-group" });
    const listenQBtn = actionGroup.createEl("button", {
      cls: "diary-copilot-pinned-toggle-btn diary-copilot-pinned-listen-btn",
      text: "🔊 聽問題",
      attr: { title: "聆聽此引導問題之英文標準發音" },
    });
    listenQBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      speakSentence(qText);
    });

    const toggleAnswerBtn = actionGroup.createEl("button", {
      cls: `diary-copilot-pinned-toggle-btn ${this.isShowingInquiryAnswers ? "is-active" : ""}`,
      text: this.isShowingInquiryAnswers ? "✍️ 收起建議回答" : "💡 查看建議回答",
      attr: { title: this.isShowingInquiryAnswers ? "換回根據您輸入即時產生的續寫句卡" : "查看 AI 針對此問題構思的範例回答" },
    });
    toggleAnswerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.isShowingInquiryAnswers = !this.isShowingInquiryAnswers;
      this.activeTabIdx = 0;
      this.resetToAutoFit();
      this.renderBrowseMode();
    });

    const dismissBtn = actionGroup.createEl("button", {
      cls: "diary-copilot-pinned-dismiss-btn",
      text: "✕",
      attr: { title: "結束此引導問句，回到平日純寫作模式" },
    });
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.clearPinnedInquiry();
    });

    // Question body
    const qBody = stripEl.createDiv({ cls: "diary-copilot-pinned-q-body" });
    qBody.createSpan({ cls: "diary-copilot-pinned-q-text", text: `❓ ${qText}` });
    if (qZh) {
      qBody.createSpan({ cls: "diary-copilot-pinned-q-zh", text: ` (${qZh})` });
    }
  }

  /**
   * Desktop 2x2 Grid Layout: all 4 cards shown simultaneously with complete multi-line wrapped sentences
   * No inner duplicate mini-buttons (clean design); top action bar operates on selected card
   */
  private renderDesktop2x2Grid() {
    if (!this.contentAreaEl) return;
    const gridEl = this.contentAreaEl.createDiv({ cls: "diary-copilot-inquiry-grid" });

    this.currentCards.forEach((card, idx) => {
      const isSelected = idx === this.activeTabIdx;
      const cardEl = gridEl.createDiv({
        cls: `diary-copilot-inquiry-grid-card ${isSelected ? "is-selected" : ""}`,
      });
      const headerEl = cardEl.createDiv({ cls: "diary-copilot-hero-header" });
      headerEl.createSpan({ cls: "diary-copilot-hero-badge", text: card.title });
      if (card.shortcut) {
        headerEl.createSpan({ cls: "key-hint", text: card.shortcut });
      }

      // Full multi-line wrapped text (shows complete sentence, no ellipsis)
      cardEl.createDiv({ cls: "diary-copilot-inquiry-grid-card-text", text: card.text });

      if (card.subText) {
        cardEl.createDiv({ cls: "diary-copilot-card-translation-source", text: card.subText });
      }

      // Action Bar inside each grid card: [ 🔊 朗讀 ] [ 🎙️ 跟讀 ] [ ⚡ 自動填入 / ⚡ 填入替換 ]
      const cardActions = cardEl.createDiv({ cls: "diary-copilot-card-actions" });

      const ttsBtn = cardActions.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-card-action-btn diary-copilot-tts-btn",
        text: "🔊 朗讀",
        attr: { title: "聆聽標準美式發音" },
      });
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        speakSentence(card.text);
      });

      const oralBtn = cardActions.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-card-action-btn diary-copilot-oral-btn",
        text: "🎙️ 跟讀",
        attr: { title: "開口說英語，視覺化即時判讀並自動填入" },
      });
      oralBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.dismissSoftKeyboard();
        this.resetToAutoFit();
        this.startOralShadowing(card.text, card.kind, this.currentItem?.sourceRange);
      });

      const isReplace = card.kind === "translation" || !!this.currentItem?.sourceRange;
      const pasteBtn = cardActions.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-card-action-btn diary-copilot-card-paste-btn",
        text: isReplace ? "⚡ 填入替換" : "⚡ 自動填入",
        attr: { title: isReplace ? "直接以此表達替換日記原文" : "直接填入筆記" },
      });
      pasteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.dismissSoftKeyboard();
        this.callbacks.onAdopt(card.text, card.kind, this.currentItem?.sourceRange, true);
        if (Platform.isMobile) {
          this.closeCards(false, true);
        }
      });

      // Single click on card body selects card, highlights it, updates header actions, and injects ghost text for shadow typing!
      // The 2x2 grid remains completely intact, ensuring panel height stays 100% stable with zero jitter!
      cardEl.addEventListener("click", (e) => {
        const sel = window.getSelection()?.toString().trim();
        if (sel && sel.length > 0) return;
        this.activeTabIdx = idx;
        gridEl.querySelectorAll(".diary-copilot-inquiry-grid-card").forEach((el, i) => {
          if (i === idx) el.addClass("is-selected");
          else el.removeClass("is-selected");
        });
        this.renderHeaderActionsBrowse();
        this.callbacks.onCardSelect?.(card.text, card.kind, this.currentItem?.sourceRange);
      });
    });
  }

  /**
   * Mobile / Tablet Layout: Single Hero Card + Bottom Capsule Tabs (NO swipe gestures to prevent sidebar conflicts)
   */
  private renderMobileSingleCard() {
    if (!this.contentAreaEl) return;
    const activeCard = this.currentCards[this.activeTabIdx] || this.currentCards[0];
    if (!activeCard) return;

    // 1. Hero Card
    const heroCard = this.contentAreaEl.createDiv({ cls: "diary-copilot-hero-card" });

    const heroHeader = heroCard.createDiv({ cls: "diary-copilot-hero-header" });
    heroHeader.createSpan({ cls: "diary-copilot-hero-badge", text: activeCard.title });
    if (activeCard.shortcut) {
      heroHeader.createSpan({ cls: "key-hint", text: activeCard.shortcut });
    }

    // Full multi-line wrapped text (shows complete sentence)
    heroCard.createDiv({ cls: "diary-copilot-hero-text", text: activeCard.text });

    if (activeCard.subText) {
      heroCard.createDiv({ cls: "diary-copilot-card-translation-source", text: activeCard.subText });
    }

    // Hero Card Action Bar (🔊 朗讀, 🎙️ 跟讀, ⚡ 自動填入 / ⚡ 填入替換)
    const cardActions = heroCard.createDiv({ cls: "diary-copilot-hero-actions" });

    const ttsBtn = cardActions.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-hero-action-btn diary-copilot-tts-btn",
      text: "🔊 朗讀",
      attr: { title: "聆聽標準美式發音" },
    });
    ttsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      speakSentence(activeCard.text);
    });

    const oralBtn = cardActions.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-hero-action-btn diary-copilot-oral-btn",
      text: "🎙️ 跟讀",
      attr: { title: "開口說英語，視覺化即時判讀並自動填入" },
    });
    oralBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.dismissSoftKeyboard();
      this.resetToAutoFit();
      this.startOralShadowing(activeCard.text, activeCard.kind, this.currentItem?.sourceRange);
    });

    const isReplace = activeCard.kind === "translation" || !!this.currentItem?.sourceRange;
    const pasteBtn = cardActions.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-hero-action-btn diary-copilot-hero-paste-btn",
      text: isReplace ? "⚡ 填入替換" : "⚡ 自動填入",
      attr: { title: isReplace ? "直接以此表達替換日記原文" : "直接填入筆記" },
    });
    pasteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.dismissSoftKeyboard();
      this.callbacks.onAdopt(activeCard.text, activeCard.kind, this.currentItem?.sourceRange, true);
      if (Platform.isMobile) {
        this.closeCards(false, true);
      }
    });

    // Tap on card: on all platforms (desktop, tablet, mobile) injects ghost text for shadow typing!
    heroCard.addEventListener("click", (e) => {
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 0) return;
      this.callbacks.onCardSelect?.(activeCard.text, activeCard.kind, this.currentItem?.sourceRange);
    });

    // 2. Capsule Tabs Row below Hero Card (shows pagination pills)
    if (this.currentCards.length > 1) {
      const tabsRow = this.contentAreaEl.createDiv({ cls: "diary-copilot-capsule-tabs" });
      this.currentCards.forEach((card, idx) => {
        const isSelected = idx === this.activeTabIdx;
        const tabBtn = tabsRow.createEl("button", {
          cls: `diary-copilot-capsule-tab ${isSelected ? "is-active" : ""}`,
          text: isSelected ? `● ${card.title}` : card.title,
        });

        // Use touchstart with preventDefault to avoid losing focus on mobile editor
        tabBtn.addEventListener("touchstart", (e) => {
          e.preventDefault();
          this.activeTabIdx = idx;
          this.resetToAutoFit();
          this.renderBrowseMode();
          this.dismissSoftKeyboard();
        }, { passive: false });

        tabBtn.addEventListener("click", (e) => {
          e.preventDefault();
          this.activeTabIdx = idx;
          this.resetToAutoFit();
          this.renderBrowseMode();
          this.dismissSoftKeyboard();
        });
      });
    }
  }

  /**
   * Render Locked Shadow Mode: Full-width target sentence + Action Bar (🔊, 🎙️, ⚡, ✨, ✕)
   */
  private renderLockedMode(targetText: string) {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    this.isOralMode = false;
    this.isShadowTyping = true;
    globalSpeechRecognizer.stop();

    if (this.brandTextEl) {
      this.brandTextEl.setText("🔒 鎖定跟寫中");
    }
    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = "none";
    }

    this.renderHeaderActionsLocked(targetText);

    const lockedCard = this.contentAreaEl.createDiv({ cls: "diary-copilot-locked-card" });
    
    // Target Sentence (Multi-line, 100% width, zero horizontal scrolling)
    lockedCard.createDiv({
      cls: "diary-copilot-locked-text",
      text: targetText,
    });

    // Subtext footnote hint
    lockedCard.createDiv({
      cls: "diary-copilot-locked-hint",
      text: Platform.isMobile
        ? "💡 提示：按上方 🎙️ 開始語音跟讀 · 或在鍵盤打字跟寫 · 點 ⚡ 填入跳過"
        : "💡 提示：按上方 🎙️ 語音跟讀 · 或直接打字跟寫 · 按 Tab 直接填入 · Esc 解鎖",
    });

    this.applyPanelHeight();
  }

  /**
   * Header Action Bar in Browse Mode: Left Group (🔊 朗讀, 🎙️ 跟讀) & Right Group (⚡ 填入, ✨ 潤飾, ✕ 關閉)
   * Center zone is completely clear for the resize handle!
   */
  private renderHeaderActionsBrowse() {
    if (this.headerActionsEl) this.headerActionsEl.empty();
    if (this.headerAudioEl) this.headerAudioEl.empty();
    if (this.headerSysEl) this.headerSysEl.empty();

    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = (this.copilotMode === "compact" || this.pinnedInquiryItem) ? "none" : "flex";
    }

    // 1. Control Center Bar (Row 1 Right): All core functions in one clean row
    if (this.headerSysEl) {
      const isNarrow = this.isNarrowHeader();

      // 0. 📅 開啟今日日記
      const todayBtn = this.headerSysEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-today-diary-btn",
        text: isNarrow ? "📅" : "📅 今日日記",
        attr: {
          "aria-label": "開啟今日日記 (Diary Copilot)",
          title: "開啟今日日記 (Diary Copilot)",
        },
      });
      todayBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onOpenTodayDiary?.();
      });

      // 1. ✨ 整理 (若手機/窄版為 "✨ 整理"，寬版為 "✨ 整理跟讀")
      const shadowBtn = this.headerSysEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-shadow-all-btn",
        text: isNarrow ? "✨ 整理" : "✨ 整理跟讀",
        attr: {
          "aria-label": "整理今日日記並開啟全篇影子跟讀",
          title: "整理今日日記並開啟全篇影子跟讀",
        },
      });
      shadowBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.dismissSoftKeyboard();
        this.callbacks.onFullTextShadowingRequest?.();
      });

      // 2. ❓ 提問引導 (F5) - Always visible in Row 1!
      if (this.pinnedInquiryItem) {
        const resumeBtn = this.headerSysEl.createEl("button", {
          cls: "diary-copilot-action-btn diary-copilot-resume-btn",
          text: isNarrow ? "✕ 提問" : "✕ 關閉提問",
          attr: { title: "關閉提問引導，回到一般寫作模式" },
        });
        resumeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.clearPinnedInquiry();
          this.callbacks.onDismiss?.();
        });
      } else {
        const inquiryBtn = this.headerSysEl.createEl("button", {
          cls: "diary-copilot-action-btn diary-copilot-inquiry-btn",
          text: isNarrow ? "❓ 提問" : "❓ 提問 (F5)",
          attr: {
            "aria-label": "根據日記內容產生是非或開放引導問句 (F5)",
            title: "根據日記內容產生是非或開放引導問句 (F5)",
          },
        });
        inquiryBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.dismissSoftKeyboard();
          this.openCards(true);
          this.callbacks.onInquiryRequest?.();
        });
      }

      // 3. ✨ 潤飾 (F3) - Always visible in Row 1!
      const polishBtn = this.headerSysEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-polish-btn",
        text: isNarrow ? "✨ 潤飾" : "✨ 潤飾 (F3)",
        attr: {
          "aria-label": "潤飾當前/前一句表達 (F3)",
          title: "潤飾當前/前一句表達 (F3)",
        },
      });
      polishBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.dismissSoftKeyboard();
        this.openCards(true);
        this.callbacks.onPolishRequest?.();
      });

      // 4. 卡片顯示切換：📖 展開 ⇄ 🔽 關閉
      const areCardsShowing = this.isCardsExpanded && 
        !this.isCollapsed && 
        !this.panelEl.hasClass("is-cards-closed") && 
        !this.panelEl.hasClass("is-keyboard-writing") && 
        !this.panelEl.hasClass("is-compact-idle");

      this.foldBtnEl = this.headerSysEl.createEl("button", {
        cls: `diary-copilot-action-btn diary-copilot-fold-toggle-btn ${areCardsShowing ? "is-expanded" : "is-folded"}`,
        text: isNarrow 
          ? (areCardsShowing ? "🔽 關閉" : "📖 展開")
          : (areCardsShowing 
              ? (Platform.isDesktop ? "🔽 關閉字卡 (Esc)" : "🔽 關閉字卡") 
              : (Platform.isDesktop ? "📖 展開字卡 (Esc)" : "📖 展開字卡")),
        attr: {
          "aria-label": areCardsShowing ? "關閉建議字卡 (Esc)" : "展開建議字卡 (Esc)",
          title: areCardsShowing ? "關閉建議字卡 (Esc)" : "展開建議字卡 (Esc)",
        },
      });
      this.foldBtnEl.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.toggleFoldCards();
      });

      // 5. ⚙️ 設定 (在手機/窄版僅顯示齒輪 ⚙️)
      const settingsBtn = this.headerSysEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-settings-btn",
        text: isNarrow ? "⚙️" : "⚙️ 設定",
        attr: { "aria-label": "Diary Copilot 快速設定", title: "Diary Copilot 快速設定" },
      });
      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.toggleSettingsMenu();
      });

      // 6. ✕ 關閉
      const closeBtn = this.headerSysEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-close-btn",
        text: "✕",
        attr: { "aria-label": "關閉 Copilot 面板", title: "關閉 Copilot 面板" },
      });
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onClose?.();
      });
    }

    // All cards (on desktop 2x2 grid and mobile single-card) already have [🔊 朗讀] [🎙️ 跟讀] [⚡ 自動填入 / ⚡ 填入替換] inside each card!
    // To keep layout neat and completely avoid duplicate buttons, hide Row 2 in browse mode across all platforms:
    if (this.headerEl) {
      const row2 = this.headerEl.querySelector(".diary-copilot-header-row-2") as HTMLElement;
      if (row2) row2.style.display = "none";
    }
  }

  /**
   * Header Action Bar in Locked Mode: 🔊 朗讀, 🎙️ 跟讀 (Left) & ⚡ 填入, ✨ 潤飾, ✕ 解鎖 (Right)
   */
  private renderHeaderActionsLocked(targetText: string) {
    if (this.headerActionsEl) this.headerActionsEl.empty();
    if (this.headerAudioEl) this.headerAudioEl.empty();
    if (this.headerSysEl) this.headerSysEl.empty();

    if (this.headerAudioEl) {
      // 1. 🔊 朗讀 (TTS) - Left Group (Row 2 Left)
      const ttsBtn = this.headerAudioEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-tts-btn",
        text: "🔊 朗讀",
        attr: { title: "聆聽標準美式發音" },
      });
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        speakSentence(targetText);
      });

      // 2. 🎙️ 跟讀 (Visual Oral Studio) - Left Group (Row 2 Left)
      const oralBtn = this.headerAudioEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-oral-btn",
        text: "🎙️ 跟讀",
        attr: { title: "開口說英語，視覺化即時辨識與自動填入" },
      });
      oralBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.resetToAutoFit();
        this.startOralShadowing(targetText, "continue", this.currentItem?.sourceRange);
      });
    }

    if (this.headerActionsEl) {
      // 3. ⚡ 填入 (Direct Paste / Skip Shadowing) - Main Actions (Row 2 Right)
      const pasteBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
        text: Platform.isMobile ? "⚡ 填入" : "⚡ 填入 (Tab)",
        attr: { title: "跳過練習，直接填入完整句子" },
      });
      pasteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.dismissSoftKeyboard();
        this.callbacks.onDirectPaste?.();
      });

      // 4. ✨ 潤飾 (Polish) - Main Actions (Row 2 Right)
      const polishBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-polish-btn",
        text: Platform.isMobile ? "✨ 潤飾" : "✨ 潤飾 (F3)",
        attr: { title: "潤飾當前/前一句表達" },
      });
      polishBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.dismissSoftKeyboard();
        this.openCards(true);
        this.callbacks.onPolishRequest?.();
      });
    }

    if (this.headerSysEl) {
      // 5. ✕ 解鎖 (Unlock & return to browse mode) - Sys Group (Row 1 Right)
      const unlockBtn = this.headerSysEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-close-btn",
        text: "✕",
        attr: { "aria-label": "解鎖卡片", title: "解鎖卡片" },
      });
      unlockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.resetToAutoFit();
        if (this.callbacks.onUnlock) {
          this.callbacks.onUnlock();
        } else {
          this.renderBrowseMode();
        }
      });
    }
  }

  // ========================================================
  // Visual Oral Shadowing Studio (即時視覺化語音跟讀工作台)
  // ========================================================

  public isOralActive(): boolean {
    return this.isOralMode;
  }

  /**
   * Starts Oral Shadowing Studio without touching note document until confirmation.
   */
  startOralShadowing(
    targetText: string,
    kind: "continue" | "alternative" | "translation",
    sourceRange?: { from: number; to: number }
  ) {
    this.isOralMode = true;
    this.callbacks.onOralStart?.();
    this.dismissSoftKeyboard();
    this.oralTargetText = targetText;
    this.oralKind = kind;
    this.oralSourceRange = sourceRange;
    this.oralPassed = false;
    this.isOralListening = true;
    this.oralLatestTranscript = "";
    if (this.oralPassTimeout) {
      window.clearTimeout(this.oralPassTimeout);
      this.oralPassTimeout = null;
    }
    this.clearAutoPassTimer();

    if (this.brandTextEl) {
      this.brandTextEl.setText("🎙️ 口說跟讀中 (en-US)");
    }
    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = "none";
    }

    this.renderHeaderActionsOral();
    this.renderOralWorkspace();

    const isWebSpeechSupported = globalSpeechRecognizer.isSupported();

    if (isWebSpeechSupported) {
      new Notice("🎙️ 語音辨識已啟動，長句可從容唸完，唸完請點「⏹️ 說完了」或停頓後自動判定...", 3500);

      globalSpeechRecognizer.start("en-US", {
        onResult: (transcript: string, _isFinal: boolean) => {
          if (!this.isOralMode || this.oralPassed) return;
          this.oralLatestTranscript = transcript;
          const match = evaluateOralMatch(transcript, this.oralTargetText, _isFinal);
          this.updateOralVisuals(match);

          if (match.isPass) {
            // Reached >= 70%: Do NOT cut off user! Allow them to finish speaking and auto-settle after 2s of silence.
            this.scheduleAutoPass(2200);
          } else {
            this.clearAutoPassTimer();
          }
        },
        onError: (err: string) => {
          if (!this.isOralMode) return;
          this.clearAutoPassTimer();
          this.isOralListening = false;
          this.renderHeaderActionsOral();
          if (err === "not-allowed" || err === "service-not-allowed") {
            new Notice("⚠️ 麥克風權限未開啟，請允許瀏覽器/Obsidian存取麥克風");
          } else if (err !== "no-speech" && err !== "aborted") {
            console.warn("[Diary Copilot Oral Error]", err);
          }
        },
        onEnd: () => {
          if (!this.isOralMode || this.oralPassed) return;
          this.clearAutoPassTimer();
          this.isOralListening = false;
          this.renderHeaderActionsOral();
          if (this.oralLatestTranscript) {
            const match = evaluateOralMatch(this.oralLatestTranscript, this.oralTargetText, true);
            this.updateOralVisuals(match);
            if (match.isPass) {
              this.handleOralPass(match);
            }
          }
        },
      }, 35000);
    } else {
      // Desktop (Windows/Mac) & iOS (iPhone/iPad): Focus voice input & prompt native dictation
      new Notice(
        Platform.isIosApp
          ? "🎙️ 已為您聚焦輸入框！請點擊鍵盤上的「麥克風 🎙️」說出英文（亦可在此直接打字）"
          : (Platform.isMacOS
              ? "🎙️ 已選取文字方塊！Mac 請連按兩次 Fn 啟動聽寫（亦可在此直接打字）"
              : "🎙️ 已選取文字方塊！請按快捷鍵 [Win + H] 啟動語音輸入，唸完可點「⏹️ 說完了」！"),
        5000
      );
      this.focusDesktopVoiceInput();
    }
  }

  private scheduleAutoPass(delayMs = 6000) {
    if (this.oralAutoFinalizeTimeout) {
      window.clearTimeout(this.oralAutoFinalizeTimeout);
    }
    this.oralAutoFinalizeTimeout = window.setTimeout(() => {
      if (this.isOralMode && !this.oralPassed) {
        this.finishOralRecording();
      }
    }, delayMs);
  }

  private clearAutoPassTimer() {
    if (this.oralAutoFinalizeTimeout) {
      window.clearTimeout(this.oralAutoFinalizeTimeout);
      this.oralAutoFinalizeTimeout = null;
    }
  }

  private focusDesktopVoiceInput() {
    if (!this.desktopVoiceInputEl) return;
    const el = this.desktopVoiceInputEl;
    el.focus();
    el.select();
    window.setTimeout(() => el.focus(), 40);
    window.setTimeout(() => el.focus(), 150);
    window.setTimeout(() => el.focus(), 350);
  }

  /**
   * Header Action Bar in Oral Mode: 🔊 示範, ⏹️ 說完了 / 🔄 重試, ⚡ 直接填入, ✕ 取消
   */
  private renderHeaderActionsOral() {
    if (this.headerActionsEl) this.headerActionsEl.empty();
    if (this.headerAudioEl) this.headerAudioEl.empty();
    if (this.headerSysEl) this.headerSysEl.empty();

    if (this.headerAudioEl) {
      // 1. 🔊 示範 (TTS Listen) - Audio Group (Row 2 Left)
      const ttsBtn = this.headerAudioEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-tts-btn",
        text: "🔊 聽示範",
        attr: { title: "再次聆聽標準發音示範" },
      });
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        speakSentence(this.oralTargetText);
      });
    }

    if (this.headerActionsEl) {
      // 2. ⏹️ 說完了 / 🔄 重試 Dynamic Toggle (方案 A) - Main Actions (Row 2 Right)
      if (this.isOralListening) {
        const finishBtn = this.headerActionsEl.createEl("button", {
          cls: "diary-copilot-action-btn diary-copilot-finish-btn",
          text: "⏹️ 說完了",
          attr: { title: "結束錄音並立即計算吻合度判定" },
        });
        finishBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.finishOralRecording();
        });
      } else {
        const retryBtn = this.headerActionsEl.createEl("button", {
          cls: "diary-copilot-action-btn diary-copilot-retry-btn",
          text: "🔄 重試",
          attr: { title: "重新開始語音跟讀" },
        });
        retryBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.restartOralShadowing();
        });
      }

      // 3. ⚡ 直接填入 (Skip Oral Drill) - Main Actions (Row 2 Right)
      const pasteBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
        text: "⚡ 直接填入",
        attr: { title: "跳過口說練習，直接將此句子填入筆記" },
      });
      pasteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleOralAdoptDirect();
      });
    }

    if (this.headerSysEl) {
      // 4. ✕ 取消跟讀 (Safe cancel without mutating note) - Sys Group (Row 1 Right)
      const cancelBtn = this.headerSysEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-close-btn",
        text: "✕ 取消",
        attr: { "aria-label": "取消跟讀", title: "取消跟讀並返回卡片" },
      });
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.cancelOralShadowing();
      });
    }

    this.renderOralDockControls();
  }

  /**
   * Prominent Ergonomic Action Dock inside Oral Studio (Thumb-friendly 44px on mobile)
   */
  private renderOralDockControls() {
    if (!this.oralDockControlsEl) return;
    this.oralDockControlsEl.empty();

    // 1. 🔊 聽示範
    const listenBtn = this.oralDockControlsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-oral-dock-btn diary-copilot-tts-btn",
      text: "🔊 聽示範",
      attr: { title: "聆聽此句子標準美式發音" },
    });
    listenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      speakSentence(this.oralTargetText);
    });

    // 2. ⏹️ 說完了 (when listening) or 🔄 重試 (when stopped/waiting)
    if (this.isOralListening) {
      const stopBtn = this.oralDockControlsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-oral-dock-btn diary-copilot-stop-listening-btn",
        text: "⏹️ 說完了",
        attr: { title: "唸完後點擊直接結算，無需等待" },
      });
      stopBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.finishOralRecording();
      });
    } else {
      const retryBtn = this.oralDockControlsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-oral-dock-btn diary-copilot-retry-btn",
        text: "🔄 重試",
        attr: { title: "重新開始跟讀練習" },
      });
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.restartOralShadowing();
      });
    }

    // 3. ⚡ 直接填入 (Skip oral drill, paste directly)
    const pasteBtn = this.oralDockControlsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-oral-dock-btn diary-copilot-oral-paste-btn",
      text: "⚡ 直接填入",
      attr: { title: "跳過口說練習，直接將此句填入筆記" },
    });
    pasteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.handleOralAdoptDirect();
    });

    // 4. ✕ 取消
    const cancelBtn = this.oralDockControlsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-oral-dock-btn diary-copilot-oral-cancel-btn",
      text: "✕ 取消",
      attr: { title: "取消跟讀並返回字卡" },
    });
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.cancelOralShadowing();
    });
  }

  /**
   * Manual Stop: User tapped "⏹️ 說完了", immediately stops microphone and evaluates.
   */
  private finishOralRecording() {
    this.clearAutoPassTimer();
    this.isOralListening = false;
    globalSpeechRecognizer.stop();
    this.renderHeaderActionsOral();

    const spokenText = this.desktopVoiceInputEl ? this.desktopVoiceInputEl.value : this.oralLatestTranscript;
    const match = evaluateOralMatch(spokenText, this.oralTargetText, true);
    this.updateOralVisuals(match);

    if (match.isPass) {
      this.handleOralPass(match);
    } else {
      const pct = Math.round(match.matchRatio * 100);
      new Notice(`辨識吻合度：${pct}%（未達 70% 門檻，可點「🔄 重試」或「⚡ 直接填入」）`, 3500);
    }
  }

  /**
   * Renders the Visual Oral Shadowing Workspace
   */
  private renderOralWorkspace() {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    const initialMatch = evaluateOralMatch("", this.oralTargetText);
    const isWebSpeechSupported = globalSpeechRecognizer.isSupported();

    this.oralWorkspaceEl = this.contentAreaEl.createDiv({ cls: "diary-copilot-oral-workspace" });

    // 1. Target Sentence Box with word spans
    const targetEl = this.oralWorkspaceEl.createDiv({ cls: "diary-copilot-oral-target" });
    this.oralTargetWordSpans = [];

    initialMatch.targetWords.forEach((word) => {
      const span = targetEl.createSpan({
        cls: "oral-word is-pending",
        text: word,
      });
      targetEl.createSpan({ text: " " });
      this.oralTargetWordSpans.push(span);
    });

    // 2. Spoken Transcript Bubble (Mobile/Browser) OR Voice Input Box (Windows/Desktop)
    if (isWebSpeechSupported) {
      const liveBox = this.oralWorkspaceEl.createDiv({ cls: "diary-copilot-oral-live-box" });
      liveBox.createSpan({ cls: "diary-copilot-oral-live-icon", text: "🎙️" });
      this.oralLiveTextEl = liveBox.createSpan({
        cls: "diary-copilot-oral-live-text is-empty",
        text: "正在聆聽... 請對著麥克風唸出上方句子",
      });
      this.desktopVoiceInputEl = null;
    } else {
      const voiceWrapper = this.oralWorkspaceEl.createDiv({ cls: "diary-copilot-desktop-voice-wrapper" });
      
      const banner = voiceWrapper.createDiv({ cls: "diary-copilot-desktop-voice-banner" });
      banner.innerHTML = Platform.isIosApp
        ? "💡 <b>已為您聚焦輸入框</b>：請點擊鍵盤上的 <kbd>🎙️ 麥克風</kbd> 說出英文（或在此直接打字練習）"
        : (Platform.isMacOS
            ? "💡 <b>已自動選取文字方塊</b>：連按兩次 <kbd>Fn</kbd> 啟動聽寫（或在此直接打字）"
            : "💡 <b>已自動選取文字方塊</b>：請按鍵盤 <kbd>Win</kbd> + <kbd>H</kbd> 啟動語音輸入（或在此直接打字）");

      const inputRow = voiceWrapper.createDiv({ cls: "diary-copilot-desktop-voice-input-row" });
      inputRow.createSpan({ cls: "diary-copilot-desktop-voice-icon", text: "🎙️" });
      this.desktopVoiceInputEl = inputRow.createEl("input", {
        cls: "diary-copilot-desktop-voice-input",
        type: "text",
        attr: {
          placeholder: Platform.isIosApp
            ? "點擊鍵盤上的 🎙️ 唸出上方句子，達 70% 自動放入..."
            : (Platform.isMacOS
                ? "已選取文字方塊！連按兩次 Fn 說話，或在此打字跟讀..."
                : "已選取文字方塊！請按 Win+H 說話，或在此打字跟讀..."),
        },
      });

      this.desktopVoiceInputEl.addEventListener("focus", () => {
        voiceWrapper.addClass("is-focused");
      });
      this.desktopVoiceInputEl.addEventListener("blur", () => {
        voiceWrapper.removeClass("is-focused");
      });

      voiceWrapper.addEventListener("click", () => {
        this.desktopVoiceInputEl?.focus();
      });
      this.oralWorkspaceEl.addEventListener("click", () => {
        this.desktopVoiceInputEl?.focus();
      });

      this.desktopVoiceInputEl.addEventListener("input", (e) => {
        if (!this.isOralMode || this.oralPassed) return;
        const val = (e.target as HTMLInputElement).value;
        this.oralLatestTranscript = val;
        const match = evaluateOralMatch(val, this.oralTargetText);
        this.updateOralVisuals(match);

        if (match.isPass) {
          this.scheduleAutoPass(2200);
        } else {
          this.clearAutoPassTimer();
        }
      });

      this.desktopVoiceInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.finishOralRecording();
        }
      });
      this.oralLiveTextEl = null;
    }

    // 3. Progress Meter (Bar + 70% threshold mark)
    const progWrapper = this.oralWorkspaceEl.createDiv({ cls: "diary-copilot-oral-progress-wrapper" });
    this.oralProgressFillEl = progWrapper.createDiv({ cls: "diary-copilot-oral-progress-fill" });

    // 4. Status Row (Score badge & Tips)
    const statusRow = this.oralWorkspaceEl.createDiv({ cls: "diary-copilot-oral-status-row" });
    this.oralScoreBadgeEl = statusRow.createSpan({
      cls: "diary-copilot-oral-score-badge",
      text: "📊 吻合度：0%（70% 達標自動放入）",
    });

    statusRow.createSpan({
      cls: "diary-copilot-oral-tip",
      text: isWebSpeechSupported
        ? "唸完點「⏹️ 說完了」或停頓後自動放入"
        : (Platform.isIosApp
            ? "點擊鍵盤 🎙️ 說出句子 · 達 70% 吻合度自動填入"
            : (Platform.isMacOS ? "按兩次 Fn 語音聽寫 · 隨時可點「⏹️ 說完了」" : "按 Win+H 語音口說 · 隨時可點「⏹️ 說完了」")),
    });

    // 5. Prominent Ergonomic Action Buttons directly in Workspace (Thumb-friendly 44px on mobile)
    this.oralDockControlsEl = this.oralWorkspaceEl.createDiv({ cls: "diary-copilot-oral-dock-controls" });
    this.renderOralDockControls();

    this.applyPanelHeight();
  }

  /**
   * Real-time visual updates on each speech recognition event
   */
  private updateOralVisuals(match: OralMatchResult) {
    if (!this.oralWorkspaceEl) return;

    // 1. Update target sentence words highlighting
    this.oralTargetWordSpans.forEach((span, idx) => {
      if (match.matchedIndices.has(idx)) {
        span.removeClass("is-pending");
        span.addClass("is-matched");
      } else {
        span.removeClass("is-matched");
        span.addClass("is-pending");
      }
    });

    // 2. Update Live Transcript or Desktop Input
    if (this.oralLiveTextEl) {
      if (match.spokenText && match.spokenText.trim().length > 0) {
        this.oralLiveTextEl.setText(`「 ${match.spokenText} 」`);
        this.oralLiveTextEl.removeClass("is-empty");
      } else {
        this.oralLiveTextEl.setText("正在聆聽... 請開始朗讀上方句子（可從容唸完）");
        this.oralLiveTextEl.addClass("is-empty");
      }
    } else if (this.desktopVoiceInputEl && this.desktopVoiceInputEl.value !== match.spokenText) {
      this.desktopVoiceInputEl.value = match.spokenText;
    }

    // 3. Update Progress Bar
    const pct = Math.min(100, Math.round(match.matchRatio * 100));
    if (this.oralProgressFillEl) {
      this.oralProgressFillEl.style.width = `${pct}%`;
      this.oralProgressFillEl.removeClass("is-warning", "is-success", "is-failed");
      if (pct >= 70) {
        this.oralProgressFillEl.addClass("is-success");
      } else if (match.isFailed) {
        this.oralProgressFillEl.addClass("is-failed");
      } else if (pct >= 40) {
        this.oralProgressFillEl.addClass("is-warning");
      }
    }

    // 4. Update Score Badge
    if (this.oralScoreBadgeEl) {
      this.oralScoreBadgeEl.removeClass("is-success", "is-failed");
      if (pct >= 70) {
        this.oralScoreBadgeEl.setText(`🎉 吻合度：${pct}%（已達標！唸完請點「⏹️ 說完了」或停頓後放入）`);
        this.oralScoreBadgeEl.addClass("is-success");
      } else if (match.isFailed) {
        this.oralScoreBadgeEl.setText(`❌ 吻合度未達 50%（${pct}%），請重新跟讀`);
        this.oralScoreBadgeEl.addClass("is-failed");
      } else {
        this.oralScoreBadgeEl.setText(`📊 吻合度：${pct}%（門檻 70%）`);
      }
    }
  }

  /**
   * Resets and restarts oral shadowing session
   */
  restartOralShadowing() {
    if (!this.isOralMode) return;
    this.oralPassed = false;
    this.isOralListening = true;
    this.oralLatestTranscript = "";
    if (this.oralPassTimeout) {
      window.clearTimeout(this.oralPassTimeout);
      this.oralPassTimeout = null;
    }
    this.clearAutoPassTimer();

    this.renderHeaderActionsOral();
    this.renderOralWorkspace();

    if (globalSpeechRecognizer.isSupported()) {
      globalSpeechRecognizer.stop();
      window.setTimeout(() => {
        if (this.isOralMode) {
          globalSpeechRecognizer.start("en-US", {
            onResult: (transcript: string, isFinal: boolean) => {
              if (!this.isOralMode || this.oralPassed) return;
              this.oralLatestTranscript = transcript;
              const match = evaluateOralMatch(transcript, this.oralTargetText, isFinal);
              this.updateOralVisuals(match);

              if (match.isPass) {
                this.scheduleAutoPass(2200);
              } else {
                this.clearAutoPassTimer();
              }
            },
            onError: () => {
              this.clearAutoPassTimer();
              this.isOralListening = false;
              this.renderHeaderActionsOral();
            },
            onEnd: () => {
              if (!this.isOralMode || this.oralPassed) return;
              this.clearAutoPassTimer();
              this.isOralListening = false;
              this.renderHeaderActionsOral();
              if (this.oralLatestTranscript) {
                const match = evaluateOralMatch(this.oralLatestTranscript, this.oralTargetText, true);
                this.updateOralVisuals(match);
                if (match.isPass) {
                  this.handleOralPass(match);
                }
              }
            },
          });
        }
      }, 100);
      new Notice("🔄 請對著麥克風重新開始跟讀，唸完請點「⏹️ 說完了」！", 2500);
    } else {
      if (this.desktopVoiceInputEl) {
        this.desktopVoiceInputEl.value = "";
      }
      this.focusDesktopVoiceInput();
      new Notice(
        Platform.isIosApp
          ? "🔄 請點擊鍵盤上的「麥克風 🎙️」重新說話跟讀！"
          : "🔄 已為您清空並重新選取文字方塊！請按 Win+H 重新口說或打字跟讀",
        2500
      );
    }
  }

  /**
   * Handles successful oral match (>= 70%) with celebratory visual feedback & atomic note insertion
   */
  private handleOralPass(match: OralMatchResult) {
    this.oralPassed = true;
    this.isOralListening = false;
    this.clearAutoPassTimer();
    globalSpeechRecognizer.stop();
    this.renderHeaderActionsOral();

    // 1. Visual success feedback
    this.oralWorkspaceEl?.addClass("is-passed");
    if (this.oralScoreBadgeEl) {
      this.oralScoreBadgeEl.setText(`🎉 辨識成功 (${Math.round(match.matchRatio * 100)}%)！正在放入筆記...`);
      this.oralScoreBadgeEl.addClass("is-success");
    }
    if (this.oralProgressFillEl) {
      this.oralProgressFillEl.style.width = "100%";
      this.oralProgressFillEl.addClass("is-success");
    }

    // 2. Visual confirmation delay (450ms) so user perceives the celebratory outcome
    const targetText = this.oralTargetText;
    const kind = this.oralKind;
    const sourceRange = this.oralSourceRange;

    this.oralPassTimeout = window.setTimeout(() => {
      this.isOralMode = false;
      if (this.callbacks.onOralAdopt) {
        this.callbacks.onOralAdopt(targetText, kind, sourceRange);
      } else {
        this.callbacks.onAdopt(targetText, kind, sourceRange, true);
      }
      this.renderIdleState();
      if (Platform.isMobile) {
        this.closeCards(false, true);
      }
    }, 450);
  }

  /**
   * Direct paste button clicked from Oral Studio
   */
  private handleOralAdoptDirect() {
    this.oralPassed = true;
    this.isOralListening = false;
    this.oralLatestTranscript = "";
    this.clearAutoPassTimer();
    globalSpeechRecognizer.stop();
    this.isOralMode = false;
    const targetText = this.oralTargetText;
    const kind = this.oralKind;
    const sourceRange = this.oralSourceRange;

    if (this.callbacks.onOralAdopt) {
      this.callbacks.onOralAdopt(targetText, kind, sourceRange);
    } else {
      this.callbacks.onAdopt(targetText, kind, sourceRange, true);
    }
    this.renderIdleState();
    if (Platform.isMobile) {
      this.closeCards(false, true);
    }
  }

  /**
   * Cancel Oral Shadowing without mutating note
   */
  private cancelOralShadowing() {
    this.oralPassed = false;
    this.isOralListening = false;
    this.oralLatestTranscript = "";
    this.clearAutoPassTimer();
    globalSpeechRecognizer.stop();
    this.isOralMode = false;
    if (this.oralPassTimeout) {
      window.clearTimeout(this.oralPassTimeout);
      this.oralPassTimeout = null;
    }
    if (this.isShadowTyping) {
      this.renderLockedMode(this.oralTargetText);
    } else {
      this.renderBrowseMode();
    }
    new Notice("已取消跟讀，筆記內容未更動", 1500);
  }

  isHidden(): boolean {
    return this.panelEl ? this.panelEl.hasClass("is-hidden") : true;
  }

  show() {
    document.body.addClass("has-diary-copilot-active");
    if (this.panelEl) {
      this.panelEl.removeClass("is-hidden");
      this.applyPanelHeight();
    }
  }

  hide() {
    document.body.removeClass("has-diary-copilot-active");
    if (this.panelEl) {
      this.panelEl.addClass("is-hidden");
    }
  }

  public closeSettingsMenu() {
    if (this.settingsEscapeHandler) {
      window.removeEventListener("keydown", this.settingsEscapeHandler);
      this.settingsEscapeHandler = null;
    }
    if (this.settingsMenuOverlayEl) {
      this.settingsMenuOverlayEl.remove();
      this.settingsMenuOverlayEl = null;
    }
  }

  public toggleSettingsMenu() {
    if (this.settingsMenuOverlayEl) {
      this.closeSettingsMenu();
      return;
    }

    // Dismiss virtual keyboard if open
    this.callbacks.onDismissKeyboard?.();

    // Create Overlay
    const overlay = document.body.createDiv({ cls: "diary-copilot-settings-overlay" });
    this.settingsMenuOverlayEl = overlay;

    // Create Sheet
    const sheet = overlay.createDiv({ cls: "diary-copilot-settings-sheet" });

    // Header
    const header = sheet.createDiv({ cls: "diary-copilot-settings-header" });
    const title = header.createDiv({ cls: "diary-copilot-settings-title" });
    title.setText("⚙️ Diary Copilot 設定");

    const closeBtn = header.createEl("button", {
      cls: "diary-copilot-settings-close-btn",
      text: "✕",
      attr: { "aria-label": "關閉設定選單", title: "關閉設定選單" },
    });
    closeBtn.addEventListener("click", () => this.closeSettingsMenu());

    // Body
    const body = sheet.createDiv({ cls: "diary-copilot-settings-body" });

    // Section 1: 🔄 外掛更新 (第一個是更新)
    const secUpdate = body.createDiv({ cls: "diary-copilot-setting-section" });
    secUpdate.createDiv({ cls: "diary-copilot-setting-section-title", text: "外掛更新" });
    const updateBtn = secUpdate.createEl("button", { cls: "diary-copilot-sheet-update-btn" });
    updateBtn.createSpan({ text: "🚀 檢查並更新外掛" });
    updateBtn.createEl("small", {
      cls: "diary-copilot-sheet-update-desc",
      text: "偵測 Plugin 資料夾同步狀態並安全重載",
    });
    updateBtn.addEventListener("click", () => {
      this.closeSettingsMenu();
      this.callbacks.onCheckUpdate?.();
    });

    // Section 2: 🎭 選擇風格 (第二個是選擇風格，有社會學、漢學、自然、內省等風格)
    const secTone = body.createDiv({ cls: "diary-copilot-setting-section" });
    secTone.createDiv({ cls: "diary-copilot-setting-section-title", text: "寫作風格（語調）" });
    const toneGrid = secTone.createDiv({ cls: "diary-copilot-tone-grid" });

    const currentTone = this.callbacks.getTone?.() || "casual";
    const toneChips: { [id: string]: HTMLElement } = {};

    for (const opt of DIARY_TONE_OPTIONS) {
      const chip = toneGrid.createDiv({
        cls: `diary-copilot-tone-chip ${opt.id === currentTone ? "is-active" : ""}`,
      });
      toneChips[opt.id] = chip;

      const chipName = chip.createDiv({ cls: "diary-copilot-tone-chip-name" });
      let icon = "🌿";
      if (opt.id === "social-science") icon = "🏛️";
      else if (opt.id === "sinology") icon = "📜";
      else if (opt.id === "reflective") icon = "🧘";
      else if (opt.id === "motivational") icon = "⚡";
      else if (opt.id === "humorous") icon = "😄";
      else if (opt.id === "vivid") icon = "🎨";

      chipName.setText(`${icon} ${opt.label}`);
      chip.createDiv({ cls: "diary-copilot-tone-chip-desc", text: opt.desc });

      chip.addEventListener("click", () => {
        Object.values(toneChips).forEach((c) => c.removeClass("is-active"));
        chip.addClass("is-active");
        this.callbacks.onToneChange?.(opt.id);
        if (this.toneSelectEl) {
          this.toneSelectEl.value = opt.id;
        }
      });
    }

    // Section 3: 🎯 英文難度（GEPT 全民英檢）
    const secLevel = body.createDiv({ cls: "diary-copilot-setting-section" });
    secLevel.createDiv({ cls: "diary-copilot-setting-section-title", text: "英文難度（GEPT 全民英檢）" });
    const levelGrid = secLevel.createDiv({ cls: "diary-copilot-tone-grid" });

    const currentLevel = this.callbacks.getEnglishLevel?.() || "upper-intermediate";
    const levelChips: { [id: string]: HTMLElement } = {};

    for (const opt of GEPT_LEVEL_OPTIONS) {
      const chip = levelGrid.createDiv({
        cls: `diary-copilot-tone-chip ${opt.id === currentLevel ? "is-active" : ""}`,
      });
      levelChips[opt.id] = chip;

      const chipName = chip.createDiv({ cls: "diary-copilot-tone-chip-name" });
      chipName.setText(`${opt.icon} ${opt.label} (${opt.badge})`);
      chip.createDiv({ cls: "diary-copilot-tone-chip-desc", text: opt.desc });

      chip.addEventListener("click", () => {
        Object.values(levelChips).forEach((c) => c.removeClass("is-active"));
        chip.addClass("is-active");
        this.callbacks.onEnglishLevelChange?.(opt.id);
      });
    }

    // Section 4: 📐 設定收摺後的高度
    const secHeight = body.createDiv({ cls: "diary-copilot-setting-section" });
    secHeight.createDiv({ cls: "diary-copilot-setting-section-title", text: "收摺後高度（底部工具列）" });
    const heightRow = secHeight.createDiv({ cls: "diary-copilot-setting-stepper-row" });

    let curHeight = this.callbacks.getCollapsedHeight?.() || 60;
    const heightPresets = [48, 60, 72, 84, 100];
    const presetsDiv = heightRow.createDiv({ cls: "diary-copilot-stepper-presets" });
    const presetBtns: { [h: number]: HTMLElement } = {};

    const updateHeightDisplay = (newH: number) => {
      curHeight = Math.max(40, Math.min(140, newH));
      heightVal.setText(`${curHeight}px`);
      Object.entries(presetBtns).forEach(([val, btn]) => {
        if (parseInt(val, 10) === curHeight) {
          btn.addClass("is-active");
        } else {
          btn.removeClass("is-active");
        }
      });
      this.callbacks.onCollapsedHeightChange?.(curHeight);
      this.applyPanelHeight();
    };

    for (const p of heightPresets) {
      const pBtn = presetsDiv.createEl("button", {
        cls: `diary-copilot-preset-btn ${p === curHeight ? "is-active" : ""}`,
        text: p === 60 ? "60px (預設)" : `${p}px`,
      });
      presetBtns[p] = pBtn;
      pBtn.addEventListener("click", () => updateHeightDisplay(p));
    }

    const ctrlsDiv = heightRow.createDiv({ cls: "diary-copilot-stepper-ctrls" });
    const minusBtn = ctrlsDiv.createEl("button", { cls: "diary-copilot-stepper-btn", text: "-" });
    const heightVal = ctrlsDiv.createSpan({ cls: "diary-copilot-stepper-val", text: `${curHeight}px` });
    const plusBtn = ctrlsDiv.createEl("button", { cls: "diary-copilot-stepper-btn", text: "+" });

    minusBtn.addEventListener("click", () => updateHeightDisplay(curHeight - 2));
    plusBtn.addEventListener("click", () => updateHeightDisplay(curHeight + 2));

    // Section 4: 🔤 字級大小
    const secFont = body.createDiv({ cls: "diary-copilot-setting-section" });
    secFont.createDiv({ cls: "diary-copilot-setting-section-title", text: "卡片字級大小" });
    const fontRow = secFont.createDiv({ cls: "diary-copilot-setting-stepper-row" });

    let curFontSize = this.callbacks.getFontSize?.() || 13.5;
    const fontPresets = [
      { size: 12, label: "小" },
      { size: 13.5, label: "標準" },
      { size: 15, label: "中" },
      { size: 16.5, label: "大" },
    ];
    const fontPresetsDiv = fontRow.createDiv({ cls: "diary-copilot-stepper-presets" });
    const fontPresetBtns: { [s: string]: HTMLElement } = {};

    const updateFontDisplay = (newSize: number) => {
      curFontSize = Math.max(10, Math.min(22, parseFloat(newSize.toFixed(1))));
      fontVal.setText(`${curFontSize}px`);
      Object.entries(fontPresetBtns).forEach(([val, btn]) => {
        if (Math.abs(parseFloat(val) - curFontSize) < 0.2) {
          btn.addClass("is-active");
        } else {
          btn.removeClass("is-active");
        }
      });
      this.callbacks.onFontSizeChange?.(curFontSize);
      document.body.style.setProperty("--diary-copilot-font-size", `${curFontSize}px`);
    };

    for (const f of fontPresets) {
      const fBtn = fontPresetsDiv.createEl("button", {
        cls: `diary-copilot-preset-btn ${Math.abs(f.size - curFontSize) < 0.2 ? "is-active" : ""}`,
        text: `${f.size}px (${f.label})`,
      });
      fontPresetBtns[f.size.toString()] = fBtn;
      fBtn.addEventListener("click", () => updateFontDisplay(f.size));
    }

    const fontCtrlsDiv = fontRow.createDiv({ cls: "diary-copilot-stepper-ctrls" });
    const fontMinusBtn = fontCtrlsDiv.createEl("button", { cls: "diary-copilot-stepper-btn", text: "-" });
    const fontVal = fontCtrlsDiv.createSpan({ cls: "diary-copilot-stepper-val", text: `${curFontSize}px` });
    const fontPlusBtn = fontCtrlsDiv.createEl("button", { cls: "diary-copilot-stepper-btn", text: "+" });

    fontMinusBtn.addEventListener("click", () => updateFontDisplay(curFontSize - 0.5));
    fontPlusBtn.addEventListener("click", () => updateFontDisplay(curFontSize + 0.5));

    // Dismiss handling
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        this.closeSettingsMenu();
      }
    });

    this.settingsEscapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.closeSettingsMenu();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", this.settingsEscapeHandler);
  }

  destroy() {
    this.closeSettingsMenu();
    document.body.removeClass("has-diary-copilot-active");
    this.isOralListening = false;
    this.oralLatestTranscript = "";
    this.clearAutoPassTimer();
    if (this.oralPassTimeout) {
      window.clearTimeout(this.oralPassTimeout);
      this.oralPassTimeout = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.onWindowResize) {
      window.removeEventListener("resize", this.onWindowResize);
      window.removeEventListener("orientationchange", this.onWindowResize);
      this.onWindowResize = null;
    }
    if (this.onVisualViewportChange && typeof window !== "undefined" && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.onVisualViewportChange);
      window.visualViewport.removeEventListener("scroll", this.onVisualViewportChange);
      this.onVisualViewportChange = null;
    }
    globalSpeechRecognizer.stop();
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }
}
