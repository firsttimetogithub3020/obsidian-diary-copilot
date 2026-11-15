import { Platform, Notice } from "obsidian";
import { SuggestionItem, DiaryTone, InquiryItem } from "../types";
import { DIARY_TONE_OPTIONS } from "../settings";
import { speakSentence } from "../services/tts";
import { globalSpeechRecognizer, evaluateOralMatch, OralMatchResult } from "../services/speech";

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
  onOralAdopt?: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onOralInput?: (spokenText: string, targetText: string) => void;
  onFocusEditor?: () => void;
}

interface CardDescriptor {
  title: string;
  shortcut: string;
  text: string;
  kind: "continue" | "alternative" | "translation";
  subText?: string | null;
}

export class CardPanel {
  private containerEl: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private statusDotEl: HTMLElement | null = null;
  private brandTextEl: HTMLElement | null = null;
  private headerHintEl: HTMLElement | null = null;
  private toneWrapperEl: HTMLElement | null = null;
  private toneSelectEl: HTMLSelectElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private contentAreaEl: HTMLElement | null = null;
  private resizeHandleEl: HTMLElement | null = null;
  private callbacks: CardPanelCallbacks;
  private currentItem: SuggestionItem | null = null;
  private isResizing = false;
  private activeTabIdx = 0;
  private currentCards: CardDescriptor[] = [];
  private isShadowTyping = false;

  // Inquiry Guided Mode State
  private isInquiryMode = false;
  private currentInquiryItem: InquiryItem | null = null;
  private inquiryCategory: "closed" | "open" = "closed";

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
  private desktopVoiceInputEl: HTMLInputElement | null = null;

  constructor(containerEl: HTMLElement, callbacks: CardPanelCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.render();
  }

  private render() {
    this.panelEl = this.containerEl.createDiv({ cls: "diary-copilot-panel" });
    if (Platform.isMobile) {
      this.panelEl.addClass("is-mobile");
    }

    // Top resize handle bar
    this.resizeHandleEl = this.panelEl.createDiv({ cls: "diary-copilot-resize-handle" });
    this.setupResizeListeners();

    // Header bar (unified action bar across browse, locked, & oral modes)
    const header = this.panelEl.createDiv({ cls: "diary-copilot-panel-header" });
    
    // Left: Brand / Mode Indicator
    const brand = header.createDiv({ cls: "diary-copilot-brand" });
    this.statusDotEl = brand.createSpan({ cls: "diary-copilot-status-dot" });
    this.brandTextEl = brand.createSpan({ cls: "diary-copilot-brand-text", text: "Diary Copilot" });

    // Middle: Tone Selector (visible in browse mode)
    this.toneWrapperEl = header.createDiv({ cls: "diary-copilot-tone-wrapper" });
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

    // Right: Unified Actions Bar
    this.headerActionsEl = header.createDiv({ cls: "diary-copilot-header-actions" });

    // Content Area
    this.contentAreaEl = this.panelEl.createDiv({ cls: "diary-copilot-panel-content" });

    this.renderIdleState();
  }

  private setupResizeListeners() {
    if (!this.resizeHandleEl) return;
    const handleEl = this.resizeHandleEl;
    handleEl.setAttribute("title", "拖曳調整高度 · 點擊快速切換標準/展開");

    let touchStartY = 0;
    let touchStartTime = 0;
    let hasMoved = false;

    // --- Touch Event Handlers for Mobile (Android, iPad, iPhone) ---
    // Using { capture: true, passive: false } prevents Obsidian's mobile Pull-Down gesture completely!
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      this.isResizing = true;
      hasMoved = false;
      const touch = e.touches[0];
      touchStartY = touch.clientY;
      touchStartTime = Date.now();

      this.panelEl?.addClass("is-resizing");
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!this.isResizing || !this.panelEl || e.touches.length !== 1) return;
      // CRITICAL: e.preventDefault() prevents browser/Obsidian mobile pull-down action!
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const touch = e.touches[0];
      if (Math.abs(touch.clientY - touchStartY) > 4) {
        hasMoved = true;
      }

      const containerRect = this.containerEl.getBoundingClientRect();
      const newHeight = containerRect.bottom - touch.clientY;
      const clampedHeight = Math.max(80, Math.min(newHeight, window.innerHeight * 0.75));

      this.panelEl.style.height = `${clampedHeight}px`;
      document.body.style.setProperty("--diary-copilot-panel-height", `${clampedHeight}px`);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!this.isResizing || !this.panelEl) return;
      this.isResizing = false;
      this.panelEl.removeClass("is-resizing");
      e.stopPropagation();
      e.stopImmediatePropagation();

      const elapsed = Date.now() - touchStartTime;
      // If it was a quick tap (< 320ms without significant drag), toggle between Standard (125px) and Expanded (240px)
      if (!hasMoved && elapsed < 320) {
        this.toggleHeightPreset();
        return;
      }

      const finalHeight = parseInt(this.panelEl.style.height, 10);
      if (!isNaN(finalHeight) && finalHeight >= 80) {
        this.callbacks.onHeightResize?.(finalHeight);
      }
    };

    const onTouchCancel = (e: TouchEvent) => {
      if (!this.isResizing || !this.panelEl) return;
      this.isResizing = false;
      this.panelEl.removeClass("is-resizing");
      e.stopPropagation();
    };

    handleEl.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    handleEl.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    handleEl.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    handleEl.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: false });

    // --- Pointer Events for Desktop Mouse Dragging & Click Toggle ---
    let pointerStartY = 0;
    let pointerStartTime = 0;
    let pointerMoved = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // Handled by touch listeners above
      if (e.button !== 0) return;
      this.isResizing = true;
      pointerMoved = false;
      pointerStartY = e.clientY;
      pointerStartTime = Date.now();
      this.panelEl?.addClass("is-resizing");
      handleEl.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!this.isResizing || !this.panelEl) return;
      e.preventDefault();
      e.stopPropagation();

      if (Math.abs(e.clientY - pointerStartY) > 3) {
        pointerMoved = true;
      }

      const containerRect = this.containerEl.getBoundingClientRect();
      const newHeight = containerRect.bottom - e.clientY;
      const clampedHeight = Math.max(80, Math.min(newHeight, window.innerHeight * 0.75));

      this.panelEl.style.height = `${clampedHeight}px`;
      document.body.style.setProperty("--diary-copilot-panel-height", `${clampedHeight}px`);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!this.isResizing || !this.panelEl) return;
      this.isResizing = false;
      this.panelEl.removeClass("is-resizing");
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}

      const elapsed = Date.now() - pointerStartTime;
      if (!pointerMoved && elapsed < 300) {
        this.toggleHeightPreset();
        return;
      }

      const finalHeight = parseInt(this.panelEl.style.height, 10);
      if (!isNaN(finalHeight) && finalHeight >= 80) {
        this.callbacks.onHeightResize?.(finalHeight);
      }
    };

    handleEl.addEventListener("pointerdown", onPointerDown);
    handleEl.addEventListener("pointermove", onPointerMove);
    handleEl.addEventListener("pointerup", onPointerUp);
    handleEl.addEventListener("pointercancel", (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!this.isResizing || !this.panelEl) return;
      this.isResizing = false;
      this.panelEl.removeClass("is-resizing");
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}
    });
  }

  /**
   * Toggles panel height between Standard (~125px) and Expanded (~240px)
   */
  private toggleHeightPreset() {
    if (!this.panelEl) return;
    const currentHeight = parseInt(this.panelEl.style.height || getComputedStyle(this.panelEl).height, 10) || 125;
    const isExpanded = currentHeight >= 200;
    const targetHeight = isExpanded ? 125 : 240;

    this.panelEl.addClass("is-animating");
    this.panelEl.style.height = `${targetHeight}px`;
    document.body.style.setProperty("--diary-copilot-panel-height", `${targetHeight}px`);

    window.setTimeout(() => {
      this.panelEl?.removeClass("is-animating");
    }, 240);

    this.callbacks.onHeightResize?.(targetHeight);
  }

  renderIdleState(message?: string) {
    if (!this.panelEl || !this.contentAreaEl) return;
    this.contentAreaEl.empty();
    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");

    this.isOralMode = false;
    this.isShadowTyping = false;

    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot is-idle";
    }
    if (this.brandTextEl) {
      this.brandTextEl.setText("Diary Copilot");
    }
    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = "flex";
    }

    this.renderHeaderActionsBrowse();

    const empty = this.contentAreaEl.createDiv({ cls: "diary-copilot-empty-state" });
    empty.createSpan({ text: message || "✍️ 在上方筆記開始書寫英語，Copilot 將即時提供地道建議與跟寫練習..." });
  }

  setLoading(message = "思考地道表達中...") {
    if (!this.panelEl || !this.contentAreaEl) return;
    this.panelEl.removeClass("is-hidden");
    this.panelEl.addClass("is-loading");

    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot is-thinking";
    }
    if (this.brandTextEl) {
      this.brandTextEl.setText(message);
    }
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

    this.isInquiryMode = false;
    this.currentInquiryItem = null;

    // If currently actively in oral mode, don't clobber unless dismissed
    if (this.isOralMode) {
      return;
    }

    if (!item || (!item.card1 && !item.card2 && !item.card3 && !item.card4 && !item.continueText)) {
      this.renderIdleState();
      return;
    }

    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }

    const c1 = item.card1 || item.continueText || "";
    const c2 = item.card2 || item.alternativeText || "";
    const c3 = item.card3 || item.translationText || "";
    const c4 = item.card4 || "";

    const hasChineseSource = !!(item.sourceRange && item.translationSource);
    const isShadow = !isPolishMode && !hasChineseSource && !c2 && !c3 && !c4 && !!c1;

    this.isShadowTyping = isShadow;

    if (isShadow) {
      // Locked Shadowing Mode (Oral & Typing Drill)
      this.renderLockedMode(c1);
      return;
    }

    // Browse Mode: Option A (Full-width Hero Card + Capsule Tabs)
    this.currentCards = [];
    if (isPolishMode) {
      if (c1) this.currentCards.push({ title: "潤飾 1 · 自然口語", shortcut: "Alt+1", text: c1, kind: "translation", subText: `原句：${item.translationSource}` });
      if (c2) this.currentCards.push({ title: "潤飾 2 · 地道生動", shortcut: "Alt+2", text: c2, kind: "translation", subText: `原句：${item.translationSource}` });
      if (c3) this.currentCards.push({ title: "潤飾 3 · 精煉有力", shortcut: "Alt+3", text: c3, kind: "translation", subText: `原句：${item.translationSource}` });
      if (c4) this.currentCards.push({ title: "潤飾 4 · 換種句式", shortcut: "Alt+4", text: c4, kind: "translation", subText: `原句：${item.translationSource}` });
    } else if (hasChineseSource) {
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

    if (this.activeTabIdx >= this.currentCards.length) {
      this.activeTabIdx = 0;
    }

    this.renderBrowseMode();
  }

  updateInquiry(item: InquiryItem) {
    if (!this.panelEl || !this.contentAreaEl) return;
    this.isInquiryMode = true;
    this.currentInquiryItem = item;
    this.currentItem = null;
    this.inquiryCategory = "closed";
    this.activeTabIdx = 0;

    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }

    this.renderBrowseMode();
  }

  /**
   * Render Option A Browse Mode: Full-width Hero Card + Capsule Tabs
   */
  private renderBrowseMode() {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    this.isOralMode = false;
    this.isShadowTyping = false;

    if (this.isInquiryMode && this.currentInquiryItem) {
      if (this.brandTextEl) {
        this.brandTextEl.setText("❓ 提問引導模式");
      }
      if (this.toneWrapperEl) {
        this.toneWrapperEl.style.display = "none";
      }

      const item = this.currentInquiryItem;
      const isClosed = this.inquiryCategory === "closed";
      const qText = isClosed ? item.closedQuestion : item.openQuestion;
      const qZh = isClosed ? item.closedChinese : item.openChinese;
      const qBanner = qZh ? `❓ ${qText}（${qZh}）` : `❓ ${qText}`;

      this.currentCards = [];
      if (isClosed) {
        if (item.yes1) this.currentCards.push({ title: "🟢 Yes · 自然口語", shortcut: "Alt+1", text: item.yes1, kind: "continue", subText: qBanner });
        if (item.yes2) this.currentCards.push({ title: "🟢 Yes · 細膩表達", shortcut: "Alt+2", text: item.yes2, kind: "continue", subText: qBanner });
        if (item.no1) this.currentCards.push({ title: "🔴 No · 自然口語", shortcut: "Alt+3", text: item.no1, kind: "continue", subText: qBanner });
        if (item.no2) this.currentCards.push({ title: "🔴 No · 細膩表達", shortcut: "Alt+4", text: item.no2, kind: "continue", subText: qBanner });
      } else {
        if (item.openStyle1) this.currentCards.push({ title: "🌿 自然口語", shortcut: "Alt+1", text: item.openStyle1, kind: "continue", subText: qBanner });
        if (item.openStyle2) this.currentCards.push({ title: "💭 情感反思", shortcut: "Alt+2", text: item.openStyle2, kind: "continue", subText: qBanner });
        if (item.openStyle3) this.currentCards.push({ title: "💼 專業嚴謹", shortcut: "Alt+3", text: item.openStyle3, kind: "continue", subText: qBanner });
        if (item.openStyle4) this.currentCards.push({ title: "⚡ 精簡有力", shortcut: "Alt+4", text: item.openStyle4, kind: "continue", subText: qBanner });
      }

      if (this.activeTabIdx >= this.currentCards.length) {
        this.activeTabIdx = 0;
      }
    } else {
      if (this.brandTextEl) {
        this.brandTextEl.setText("Diary Copilot");
      }
      if (this.toneWrapperEl) {
        this.toneWrapperEl.style.display = "flex";
      }
    }

    this.renderHeaderActionsBrowse();

    if (this.currentCards.length === 0) {
      this.renderIdleState();
      return;
    }

    // If in Inquiry Mode, render category switcher tabs at top: [❓ 是非引導 (Yes/No)] [💭 開放引導 (Wh-)]
    if (this.isInquiryMode) {
      const catRow = this.contentAreaEl.createDiv({ cls: "diary-copilot-capsule-tabs diary-copilot-inquiry-cat-tabs" });
      const isClosed = this.inquiryCategory === "closed";

      const closedTab = catRow.createEl("button", {
        cls: `diary-copilot-capsule-tab ${isClosed ? "is-active" : ""}`,
        text: "❓ 是非引導 (Yes/No)",
      });
      closedTab.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (this.inquiryCategory !== "closed") {
          this.inquiryCategory = "closed";
          this.activeTabIdx = 0;
          this.renderBrowseMode();
        }
      });

      const openTab = catRow.createEl("button", {
        cls: `diary-copilot-capsule-tab ${!isClosed ? "is-active" : ""}`,
        text: "💭 開放引導 (Wh-)",
      });
      openTab.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (this.inquiryCategory !== "open") {
          this.inquiryCategory = "open";
          this.activeTabIdx = 0;
          this.renderBrowseMode();
        }
      });
    }

    const activeCard = this.currentCards[this.activeTabIdx] || this.currentCards[0];

    // 1. Full-width Hero Card (Multi-line wrap, zero horizontal scrolling)
    const heroCard = this.contentAreaEl.createDiv({ cls: "diary-copilot-hero-card" });

    // Badge & Action hint in Hero Card
    const heroHeader = heroCard.createDiv({ cls: "diary-copilot-hero-header" });
    heroHeader.createSpan({ cls: "diary-copilot-hero-badge", text: activeCard.title });
    if (!Platform.isMobile && activeCard.shortcut) {
      heroHeader.createSpan({ cls: "key-hint", text: activeCard.shortcut });
    }
    heroHeader.createSpan({ cls: "diary-copilot-hero-action-hint", text: "⚡直接填入 · 點擊卡片跟寫 · 🎙️跟讀" });

    // Full multi-line wrapped text
    heroCard.createDiv({ cls: "diary-copilot-hero-text", text: activeCard.text });

    if (activeCard.subText) {
      heroCard.createDiv({ cls: "diary-copilot-card-translation-source", text: activeCard.subText });
    }

    // Click handler on Hero Card initiates Shadow Typing (isDirectPaste = false)
    let startX = 0;
    let startY = 0;
    heroCard.addEventListener("mousedown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
    });
    heroCard.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length > 0) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
    }, { passive: true });

    heroCard.addEventListener("click", (e) => {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist > 5) return;
      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 0) return;
      // Adopt as shadow-typing drill
      this.callbacks.onAdopt(activeCard.text, activeCard.kind, this.currentItem?.sourceRange, false);
    });

    // 2. Capsule Tabs Row (Clean pills below Hero Card)
    const tabsRow = this.contentAreaEl.createDiv({ cls: "diary-copilot-capsule-tabs" });
    this.currentCards.forEach((card, idx) => {
      const isSelected = idx === this.activeTabIdx;
      const tabBtn = tabsRow.createEl("button", {
        cls: `diary-copilot-capsule-tab ${isSelected ? "is-active" : ""}`,
        text: isSelected ? `● ${card.title}` : card.title,
      });

      tabBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.activeTabIdx = idx;
        this.renderBrowseMode();
      });
    });
  }

  /**
   * Render Locked Shadow Mode: Full-width target sentence + Action Bar (🔊, 🎙️, ⚡, ✨, ✕)
   */
  private renderLockedMode(targetText: string) {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    this.isOralMode = false;
    this.isShadowTyping = true;

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
  }

  /**
   * Header Action Bar in Browse Mode: 🔊 朗讀, 🎙️ 跟讀, ⚡ 填入, ✨ 潤飾, ✕ 關閉
   */
  private renderHeaderActionsBrowse() {
    if (!this.headerActionsEl) return;
    this.headerActionsEl.empty();

    const activeCard = this.currentCards[this.activeTabIdx] || this.currentCards[0];

    if (activeCard) {
      // 1. 🔊 朗讀 (TTS)
      const ttsBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-tts-btn",
        text: "🔊 朗讀",
        attr: { title: "聆聽標準美式發音" },
      });
      ttsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        speakSentence(activeCard.text);
      });

      // 2. 🎙️ 語音跟讀 (Starts Visual Oral Studio)
      const oralBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-oral-btn",
        text: "🎙️ 跟讀",
        attr: { title: "開口說英語，視覺化即時判讀並自動填入" },
      });
      oralBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startOralShadowing(activeCard.text, activeCard.kind, this.currentItem?.sourceRange);
      });

      // 3. ⚡ 填入 (Direct Paste)
      const pasteBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
        text: "⚡ 填入",
        attr: { title: "直接將此句子填入筆記（正常文字，無灰字）" },
      });
      pasteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onAdopt(activeCard.text, activeCard.kind, this.currentItem?.sourceRange, true);
      });
    }

    if (this.isInquiryMode) {
      // ✍️ 回續寫
      const resumeBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-resume-btn",
        text: "✍️ 回續寫",
        attr: { title: "回到平日續寫模式" },
      });
      resumeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.isInquiryMode = false;
        this.currentInquiryItem = null;
        this.callbacks.onDismiss?.();
      });
    } else {
      // 4. ❓ 提問
      const inquiryBtn = this.headerActionsEl.createEl("button", {
        cls: "diary-copilot-action-btn diary-copilot-inquiry-btn",
        text: Platform.isMobile ? "❓ 提問" : "❓ 提問 (F4)",
        attr: { title: "根據日記內容產生是非或開放引導問句" },
      });
      inquiryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onInquiryRequest?.();
      });
    }

    // 5. ✨ 潤飾
    const polishBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-polish-btn",
      text: Platform.isMobile ? "✨ 潤飾" : "✨ 潤飾 (F3)",
      attr: { title: "潤飾當前/前一句表達" },
    });
    polishBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.callbacks.onPolishRequest?.();
    });

    // 5. ✕ 關閉
    const closeBtn = this.headerActionsEl.createEl("button", {
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

  /**
   * Header Action Bar in Locked Mode: 🔊 朗讀, 🎙️ 跟讀, ⚡ 填入, ✨ 潤飾, ✕ 解鎖
   */
  private renderHeaderActionsLocked(targetText: string) {
    if (!this.headerActionsEl) return;
    this.headerActionsEl.empty();

    // 1. 🔊 朗讀 (TTS)
    const ttsBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-tts-btn",
      text: "🔊 朗讀",
      attr: { title: "聆聽標準美式發音" },
    });
    ttsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      speakSentence(targetText);
    });

    // 2. 🎙️ 跟讀 (Visual Oral Studio)
    const oralBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-oral-btn",
      text: "🎙️ 跟讀",
      attr: { title: "開口說英語，視覺化即時辨識與自動填入" },
    });
    oralBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.startOralShadowing(targetText, "continue", this.currentItem?.sourceRange);
    });

    // 3. ⚡ 填入 (Direct Paste / Skip Shadowing)
    const pasteBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-direct-paste-btn",
      text: Platform.isMobile ? "⚡ 填入" : "⚡ 填入 (Tab)",
      attr: { title: "跳過練習，直接填入完整句子" },
    });
    pasteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.callbacks.onDirectPaste?.();
    });

    // 4. ✨ 潤飾 (Polish)
    const polishBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-polish-btn",
      text: Platform.isMobile ? "✨ 潤飾" : "✨ 潤飾 (F3)",
      attr: { title: "潤飾當前/前一句表達" },
    });
    polishBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.callbacks.onPolishRequest?.();
    });

    // 5. ✕ 解鎖 (Unlock & return to browse mode)
    const unlockBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-close-btn",
      text: "✕",
      attr: { "aria-label": "解鎖卡片", title: "解鎖卡片" },
    });
    unlockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.callbacks.onUnlock) {
        this.callbacks.onUnlock();
      } else {
        this.callbacks.onDismiss();
      }
    });
  }

  // ========================================================
  // Visual Oral Shadowing Studio (即時視覺化語音跟讀工作台)
  // ========================================================

  /**
   * Starts Oral Shadowing Studio without touching note document until confirmation.
   */
  startOralShadowing(
    targetText: string,
    kind: "continue" | "alternative" | "translation",
    sourceRange?: { from: number; to: number }
  ) {
    this.isOralMode = true;
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
      });
    } else {
      // Desktop / Windows Electron: Focus voice input & prompt Win+H
      new Notice(
        Platform.isMacOS
          ? "🎙️ 已選取文字方塊！Mac 請連按兩次 Fn 啟動聽寫（亦可在此直接打字）"
          : "🎙️ 已選取文字方塊！請按快捷鍵 [Win + H] 啟動語音輸入，唸完可點「⏹️ 說完了」！",
        5000
      );
      this.focusDesktopVoiceInput();
    }
  }

  private scheduleAutoPass(delayMs = 2200) {
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
    if (!this.headerActionsEl) return;
    this.headerActionsEl.empty();

    // 1. 🔊 示範 (TTS Listen)
    const ttsBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-tts-btn",
      text: "🔊 聽示範",
      attr: { title: "再次聆聽標準發音示範" },
    });
    ttsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      speakSentence(this.oralTargetText);
    });

    // 2. ⏹️ 說完了 / 🔄 重試 Dynamic Toggle (方案 A)
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

    // 3. ⚡ 直接填入 (Skip Oral Drill)
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

    // 4. ✕ 取消跟讀 (Safe cancel without mutating note)
    const cancelBtn = this.headerActionsEl.createEl("button", {
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
      banner.innerHTML = Platform.isMacOS
        ? "💡 <b>已自動選取文字方塊</b>：連按兩次 <kbd>Fn</kbd> 啟動聽寫（或在此直接打字）"
        : "💡 <b>已自動選取文字方塊</b>：請按鍵盤 <kbd>Win</kbd> + <kbd>H</kbd> 啟動語音輸入（或在此直接打字）";

      const inputRow = voiceWrapper.createDiv({ cls: "diary-copilot-desktop-voice-input-row" });
      inputRow.createSpan({ cls: "diary-copilot-desktop-voice-icon", text: "🎙️" });
      this.desktopVoiceInputEl = inputRow.createEl("input", {
        cls: "diary-copilot-desktop-voice-input",
        type: "text",
        attr: {
          placeholder: Platform.isMacOS
            ? "已選取文字方塊！連按兩次 Fn 說話，或在此打字跟讀..."
            : "已選取文字方塊！請按 Win+H 說話，或在此打字跟讀...",
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
        ? (Platform.isMobile ? "唸完點「⏹️ 說完了」或停頓後自動放入" : "唸完點「⏹️ 說完了」或停頓後自動放入")
        : (Platform.isMacOS ? "按兩次 Fn 語音聽寫 · 隨時可點「⏹️ 說完了」" : "按 Win+H 語音口說 · 隨時可點「⏹️ 說完了」"),
    });
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
      new Notice("🔄 已為您清空並重新選取文字方塊！請按 Win+H 重新口說或打字跟讀", 2500);
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
    this.oralPassTimeout = window.setTimeout(() => {
      this.isOralMode = false;
      if (this.callbacks.onOralAdopt) {
        this.callbacks.onOralAdopt(this.oralTargetText, this.oralKind, this.oralSourceRange);
      } else {
        this.callbacks.onAdopt(this.oralTargetText, this.oralKind, this.oralSourceRange, true);
      }
      this.renderIdleState();
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
    if (this.callbacks.onOralAdopt) {
      this.callbacks.onOralAdopt(this.oralTargetText, this.oralKind, this.oralSourceRange);
    } else {
      this.callbacks.onAdopt(this.oralTargetText, this.oralKind, this.oralSourceRange, true);
    }
    this.renderIdleState();
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
    if (this.panelEl) {
      this.panelEl.removeClass("is-hidden");
    }
  }

  hide() {
    if (this.panelEl) {
      this.panelEl.addClass("is-hidden");
    }
  }

  destroy() {
    this.isOralListening = false;
    this.oralLatestTranscript = "";
    this.clearAutoPassTimer();
    if (this.oralPassTimeout) {
      window.clearTimeout(this.oralPassTimeout);
      this.oralPassTimeout = null;
    }
    globalSpeechRecognizer.stop();
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }
}
