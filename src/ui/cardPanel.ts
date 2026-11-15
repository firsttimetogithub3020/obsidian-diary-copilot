import { Platform, Notice } from "obsidian";
import { SuggestionItem, DiaryTone } from "../types";
import { DIARY_TONE_OPTIONS } from "../settings";
import { speakSentence } from "../services/tts";
import { globalSpeechRecognizer } from "../services/speech";

export interface CardPanelCallbacks {
  onAdopt: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onDismiss: () => void;
  onHeightResize?: (newHeight: number) => void;
  onToneChange?: (tone: DiaryTone) => void;
  getTone?: () => DiaryTone;
  onPolishRequest?: () => void;
  onClose?: () => void;
  onDirectPaste?: () => void;
  onUnlock?: () => void;
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

    // Header bar (unified action bar across browse & locked modes)
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
      const selectedTone = (e.target as HTMLSelectElement).value as DiaryTone;
      this.callbacks.onToneChange?.(selectedTone);
    });

    // Right: Unified Actions Container
    this.headerActionsEl = header.createDiv({ cls: "diary-copilot-header-actions" });

    // Main Content Area (Option A: Full-width Hero Card + Capsule Tabs)
    this.contentAreaEl = this.panelEl.createDiv({ cls: "diary-copilot-content-area" });
    this.renderIdleState();
  }

  private setupResizeListeners() {
    const handleEl = this.resizeHandleEl;
    if (!handleEl) return;

    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    const onMove = (clientY: number) => {
      if (!isDragging || !this.panelEl) return;
      const diffY = startY - clientY;
      const minH = Platform.isMobile ? 70 : 80;
      const maxH = Math.round(window.innerHeight * 0.8);
      const newHeight = Math.round(Math.max(minH, Math.min(maxH, startHeight + diffY)));

      this.panelEl.style.height = `${newHeight}px`;
      document.body.style.setProperty("--diary-copilot-panel-height", `${newHeight}px`);
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      this.isResizing = false;
      this.panelEl?.removeClass("is-resizing");

      if (this.panelEl) {
        const finalHeight = Math.round(this.panelEl.getBoundingClientRect().height);
        if (this.callbacks.onHeightResize) {
          this.callbacks.onHeightResize(finalHeight);
        }
      }
    };

    handleEl.addEventListener("pointerdown", (e: PointerEvent) => {
      if (!this.panelEl) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      this.isResizing = true;
      this.panelEl.addClass("is-resizing");

      startY = e.clientY;
      startHeight = this.panelEl.getBoundingClientRect().height;

      try {
        handleEl.setPointerCapture(e.pointerId);
      } catch {}
    });

    handleEl.addEventListener("pointermove", (e: PointerEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      onMove(e.clientY);
    });

    handleEl.addEventListener("pointerup", (e: PointerEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}
      onEnd();
    });

    handleEl.addEventListener("pointercancel", (e: PointerEvent) => {
      if (!isDragging) return;
      try {
        handleEl.releasePointerCapture(e.pointerId);
      } catch {}
      onEnd();
    });
  }

  renderIdleState(message?: string) {
    if (!this.contentAreaEl) return;
    this.panelEl?.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }
    if (this.brandTextEl) {
      this.brandTextEl.setText("Diary Copilot");
    }
    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = "flex";
    }
    this.isShadowTyping = false;
    this.renderHeaderActionsBrowse();

    const defaultMsg = message || "✍️ 請開始書寫，AI 將在此即時提供 4 種道地英文建議...";
    this.contentAreaEl.empty();
    const emptyBox = this.contentAreaEl.createDiv({ cls: "diary-copilot-empty-state" });
    emptyBox.setText(defaultMsg);
  }

  setLoading(message?: string) {
    if (!this.panelEl) return;
    this.panelEl.removeClass("is-hidden");
    this.panelEl.addClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot loading";
    }
    if (this.brandTextEl && message) {
      this.brandTextEl.setText(message);
    }
  }

  setError(message = "⚠️ 連線異常或尚未設定 API Key") {
    if (!this.panelEl) return;
    this.panelEl.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot error";
    }
    if (this.brandTextEl) {
      this.brandTextEl.setText(message);
    }
    if (!this.currentItem) {
      this.renderIdleState(message);
    }
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

  /**
   * Render Option A Browse Mode: Full-width Hero Card + Capsule Tabs
   */
  private renderBrowseMode() {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    if (this.brandTextEl) {
      this.brandTextEl.setText("Diary Copilot");
    }
    if (this.toneWrapperEl) {
      this.toneWrapperEl.style.display = "flex";
    }

    this.renderHeaderActionsBrowse();

    if (this.currentCards.length === 0) {
      this.renderIdleState();
      return;
    }

    const activeCard = this.currentCards[this.activeTabIdx] || this.currentCards[0];

    // 1. Full-width Hero Card (Multi-line wrap, zero horizontal scrolling)
    const heroCard = this.contentAreaEl.createDiv({ cls: "diary-copilot-hero-card" });

    // Badge & Action hint in Hero Card
    const heroHeader = heroCard.createDiv({ cls: "diary-copilot-hero-header" });
    const badgeSpan = heroHeader.createSpan({ cls: "diary-copilot-hero-badge", text: activeCard.title });
    if (!Platform.isMobile && activeCard.shortcut) {
      heroHeader.createSpan({ cls: "key-hint", text: activeCard.shortcut });
    }
    heroHeader.createSpan({ cls: "diary-copilot-hero-action-hint", text: "👉 點擊卡片鎖定跟讀／跟寫" });

    // Full multi-line wrapped text
    const textEl = heroCard.createDiv({ cls: "diary-copilot-hero-text", text: activeCard.text });

    if (activeCard.subText) {
      heroCard.createDiv({ cls: "diary-copilot-card-translation-source", text: activeCard.subText });
    }

    // Click handler to adopt into locked mode (with drag-selection protection)
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
      this.callbacks.onAdopt(activeCard.text, activeCard.kind, this.currentItem?.sourceRange);
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
   * Render Locked Shadow Mode: Full-width target sentence + Unified Action Bar (🔊, ⚡, ✨, ✕)
   */
  private renderLockedMode(targetText: string) {
    if (!this.contentAreaEl) return;
    this.contentAreaEl.empty();

    if (this.brandTextEl) {
      this.brandTextEl.setText("🔒 跟寫 / 口說跟讀中");
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
        ? "💡 提示：按鍵盤 🎤 唸出這句話（80% 自動通過）· 或直接打字跟寫 · 點 ⚡ 填入跳過"
        : "💡 提示：直接打字跟寫 · Win+H 語音跟讀 · 按 Tab 直接填入 · Esc 解鎖",
    });
  }

  /**
   * Header Action Bar in Browse Mode: Polish & Close
   */
  private renderHeaderActionsBrowse() {
    if (!this.headerActionsEl) return;
    this.headerActionsEl.empty();

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
   * Unified Header Action Bar in Locked Mode: 🔊 朗讀, ⚡ 填入, ✨ 潤飾, ✕ 解鎖
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

    // 2. 🎙️ 跟讀 (Speech Recognition in en-US)
    const oralBtn = this.headerActionsEl.createEl("button", {
      cls: "diary-copilot-action-btn diary-copilot-oral-btn",
      text: "🎙️ 跟讀",
      attr: { title: "開口說英語，自動語音辨識與輸入" },
    });
    oralBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (globalSpeechRecognizer.getIsListening()) {
        globalSpeechRecognizer.stop();
        oralBtn.setText("🎙️ 跟讀");
        oralBtn.removeClass("is-recording");
        return;
      }

      if (!globalSpeechRecognizer.isSupported()) {
        this.callbacks.onFocusEditor?.();
        new Notice("💡 請在鍵盤上點擊 🎤 麥克風圖示開始說英語跟讀", 3500);
        return;
      }

      oralBtn.setText("🔴 聆聽中...");
      oralBtn.addClass("is-recording");
      new Notice("🎙️ 請對著手機唸出這句話（自動英語辨識）...", 2200);

      globalSpeechRecognizer.start("en-US", {
        onResult: (transcript, _isFinal) => {
          if (this.callbacks.onOralInput) {
            this.callbacks.onOralInput(transcript, targetText);
          }
        },
        onError: (err) => {
          oralBtn.setText("🎙️ 跟讀");
          oralBtn.removeClass("is-recording");
          if (err !== "no-speech") {
            new Notice(`語音辨識提示：${err}`);
          }
        },
        onEnd: () => {
          oralBtn.setText("🎙️ 跟讀");
          oralBtn.removeClass("is-recording");
        },
      });
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

    // 3. ✨ 潤飾 (Polish)
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

    // 4. ✕ 解鎖 (Unlock & return to browse mode)
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
    globalSpeechRecognizer.stop();
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }
}
