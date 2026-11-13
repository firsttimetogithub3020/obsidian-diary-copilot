import { Platform } from "obsidian";
import { SuggestionItem, DiaryTone } from "../types";
import { DIARY_TONE_OPTIONS } from "../settings";

export interface CardPanelCallbacks {
  onAdopt: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onDismiss: () => void;
  onHeightResize?: (newHeight: number) => void;
  onToneChange?: (tone: DiaryTone) => void;
  getTone?: () => DiaryTone;
  onPolishRequest?: () => void;
}

export class CardPanel {
  private containerEl: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private statusDotEl: HTMLElement | null = null;
  private headerHintEl: HTMLElement | null = null;
  private toneSelectEl: HTMLSelectElement | null = null;
  private cardsRowEl: HTMLElement | null = null;
  private resizeHandleEl: HTMLElement | null = null;
  private callbacks: CardPanelCallbacks;
  private currentItem: SuggestionItem | null = null;
  private isResizing = false;
  private toggleExpandBtn: HTMLElement | null = null;
  private isExpanded = false;

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

    // Top status bar
    const header = this.panelEl.createDiv({ cls: "diary-copilot-panel-header" });
    const brand = header.createDiv({ cls: "diary-copilot-brand" });
    this.statusDotEl = brand.createSpan({ cls: "diary-copilot-status-dot" });
    brand.createSpan({ text: "Diary Copilot" });

    // Middle: Tone selector dropdown
    const toneWrapper = header.createDiv({ cls: "diary-copilot-tone-wrapper" });
    toneWrapper.createSpan({ cls: "diary-copilot-tone-label", text: "語調：" });

    this.toneSelectEl = toneWrapper.createEl("select", { cls: "diary-copilot-tone-select" });
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

    // Polish button (one-click F3 trigger, especially vital for Android & mobile!)
    const polishBtn = header.createEl("button", {
      cls: "diary-copilot-polish-btn",
      text: Platform.isMobile ? "✨ 潤飾" : "✨ 潤飾 (F3)",
    });
    polishBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.callbacks.onPolishRequest?.();
    });

    // Expand / Collapse toggle button (one-tap auto pull up to see all 4 cards)
    this.toggleExpandBtn = header.createEl("button", {
      cls: "diary-copilot-expand-btn",
      text: "🔼 展開字卡",
    });
    this.toggleExpandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.toggleExpandState();
    });

    this.headerHintEl = header.createSpan({ cls: "diary-copilot-hint" });
    this.headerHintEl.setText(Platform.isMobile ? "點擊卡片跟寫" : "Alt+1/2/3/4 或點擊卡片跟寫 · Esc 關閉");

    // Cards row (4 columns)
    this.cardsRowEl = this.panelEl.createDiv({ cls: "diary-copilot-cards-row" });
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
      const diffY = startY - clientY; // Dragging up increases height
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

    // 1. Pointer Events with Pointer Capture (seamless on iPad, Android & Desktop)
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

    // 2. Direct Touch Events (prevents mobile page scrolling during drag)
    handleEl.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        if (e.touches.length > 0 && this.panelEl) {
          e.preventDefault();
          e.stopPropagation();
          isDragging = true;
          this.isResizing = true;
          this.panelEl.addClass("is-resizing");
          startY = e.touches[0].clientY;
          startHeight = this.panelEl.getBoundingClientRect().height;
        }
      },
      { passive: false }
    );

    handleEl.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        if (!isDragging || e.touches.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        onMove(e.touches[0].clientY);
      },
      { passive: false }
    );

    handleEl.addEventListener("touchend", (e: TouchEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      onEnd();
    });

    handleEl.addEventListener("touchcancel", (e: TouchEvent) => {
      if (!isDragging) return;
      onEnd();
    });
  }

  renderIdleState(message?: string) {
    if (!this.cardsRowEl) return;
    this.panelEl?.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }
    const defaultMsg = message || "✍️ 請開始書寫，AI 將在此即時提供 4 種道地英文建議...";
    if (this.headerHintEl) {
      this.headerHintEl.setText(Platform.isMobile ? "開始書寫即可獲得建議" : "開始書寫即可獲得建議 · F3 潤飾句型");
    }
    this.cardsRowEl.empty();
    this.cardsRowEl.removeClass("is-shadow-typing");
    const emptyBox = this.cardsRowEl.createDiv({ cls: "diary-copilot-empty-state" });
    emptyBox.setText(defaultMsg);
  }

  setLoading(message?: string) {
    if (!this.panelEl) return;
    this.panelEl.removeClass("is-hidden");
    this.panelEl.addClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot loading";
    }
    if (this.headerHintEl && message) {
      this.headerHintEl.setText(message);
    }
  }

  setError(message = "⚠️ 連線異常或尚未設定 API Key") {
    if (!this.panelEl) return;
    this.panelEl.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot error";
    }
    if (this.headerHintEl) {
      this.headerHintEl.setText(message);
    }
    if (!this.currentItem) {
      this.renderIdleState(message);
    }
  }

  toggleExpandState() {
    if (!this.panelEl || !this.toggleExpandBtn) return;
    this.isExpanded = !this.isExpanded;

    if (this.isExpanded) {
      this.panelEl.addClass("is-expanded");
      this.toggleExpandBtn.setText("🔽 收合");
      this.toggleExpandBtn.addClass("is-active");
      document.body.style.setProperty("--diary-copilot-panel-height", "285px");
    } else {
      this.panelEl.removeClass("is-expanded");
      this.toggleExpandBtn.setText("🔼 展開字卡");
      this.toggleExpandBtn.removeClass("is-active");
      const baseHeight = this.panelEl.style.height || "160px";
      document.body.style.setProperty("--diary-copilot-panel-height", baseHeight);
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
    if (!this.panelEl || !this.cardsRowEl) return;

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
    const isShadowTyping = !isPolishMode && !hasChineseSource && !c2 && !c3 && !c4 && !!c1;

    if (this.headerHintEl) {
      if (isShadowTyping) {
        this.headerHintEl.setText("跟寫練習中：打錯可 ⌫ 修正 · Enter / Esc 解鎖卡片");
      } else if (isPolishMode) {
        this.headerHintEl.setText("F3 潤飾：按 Alt+1/2/3/4 或點擊卡片跟寫 · Esc 關閉");
      } else if (hasChineseSource) {
        this.headerHintEl.setText(`中翻英：按 Alt+1/2/3/4 消除【${item.translationSource}】並跟寫 · Esc 關閉`);
      } else {
        this.headerHintEl.setText(Platform.isMobile ? "點擊卡片跟寫" : "F3 潤飾 · Alt+1/2/3/4 跟寫 · Esc 關閉");
      }
    }

    this.cardsRowEl.empty();

    if (isShadowTyping) {
      this.cardsRowEl.addClass("is-shadow-typing");
      this.renderCard(
        this.cardsRowEl,
        "🔒 跟寫練習中 (目標句子已鎖定)",
        "鎖定中",
        c1,
        () => {},
        "灰字同步推進 · 打錯按 ⌫ 倒退修正 · 按 Enter / Esc 立即解鎖"
      );
      return;
    }

    this.cardsRowEl.removeClass("is-shadow-typing");

    if (isPolishMode) {
      if (c1) {
        this.renderCard(
          this.cardsRowEl,
          "潤飾 1 · 自然口語",
          Platform.isMobile ? "" : "Alt+1",
          c1,
          () => this.callbacks.onAdopt(c1, "translation", item.sourceRange),
          `原句：${item.translationSource}`
        );
      }
      if (c2) {
        this.renderCard(
          this.cardsRowEl,
          "潤飾 2 · 地道生動",
          Platform.isMobile ? "" : "Alt+2",
          c2,
          () => this.callbacks.onAdopt(c2, "translation", item.sourceRange),
          `原句：${item.translationSource}`
        );
      }
      if (c3) {
        this.renderCard(
          this.cardsRowEl,
          "潤飾 3 · 精煉有力",
          Platform.isMobile ? "" : "Alt+3",
          c3,
          () => this.callbacks.onAdopt(c3, "translation", item.sourceRange),
          `原句：${item.translationSource}`
        );
      }
      if (c4) {
        this.renderCard(
          this.cardsRowEl,
          "潤飾 4 · 換種句式",
          Platform.isMobile ? "" : "Alt+4",
          c4,
          () => this.callbacks.onAdopt(c4, "translation", item.sourceRange),
          `原句：${item.translationSource}`
        );
      }
      return;
    }

    // Chinese Translation Mode (All 4 cards REPLACE the Chinese segment)
    if (hasChineseSource) {
      if (c1) {
        this.renderCard(
          this.cardsRowEl,
          "卡 1 · 自然口語",
          Platform.isMobile ? "" : "Alt+1",
          c1,
          () => this.callbacks.onAdopt(c1, "translation", item.sourceRange),
          `消除：${item.translationSource}`
        );
      }

      if (c2) {
        this.renderCard(
          this.cardsRowEl,
          "卡 2 · 地道片語",
          Platform.isMobile ? "" : "Alt+2",
          c2,
          () => this.callbacks.onAdopt(c2, "translation", item.sourceRange),
          `消除：${item.translationSource}`
        );
      }

      if (c3) {
        this.renderCard(
          this.cardsRowEl,
          "卡 3 · 精煉簡潔",
          Platform.isMobile ? "" : "Alt+3",
          c3,
          () => this.callbacks.onAdopt(c3, "translation", item.sourceRange),
          `消除：${item.translationSource}`
        );
      }

      if (c4) {
        this.renderCard(
          this.cardsRowEl,
          "卡 4 · 換種句式",
          Platform.isMobile ? "" : "Alt+4",
          c4,
          () => this.callbacks.onAdopt(c4, "translation", item.sourceRange),
          `消除：${item.translationSource}`
        );
      }
      return;
    }

    // Normal English Suggestion Mode (4 distinct directions)
    if (c1) {
      this.renderCard(
        this.cardsRowEl,
        "卡 1 · 猜下一句",
        Platform.isMobile ? "" : "Alt+1",
        c1,
        () => this.callbacks.onAdopt(c1, "continue", item.sourceRange)
      );
    }

    if (c2) {
      this.renderCard(
        this.cardsRowEl,
        "卡 2 · 內心感受",
        Platform.isMobile ? "" : "Alt+2",
        c2,
        () => this.callbacks.onAdopt(c2, "alternative", item.sourceRange)
      );
    }

    if (c3) {
      this.renderCard(
        this.cardsRowEl,
        "卡 3 · 細節展開",
        Platform.isMobile ? "" : "Alt+3",
        c3,
        () => this.callbacks.onAdopt(c3, "alternative", item.sourceRange)
      );
    }

    if (c4) {
      this.renderCard(
        this.cardsRowEl,
        "卡 4 · 地道片語",
        Platform.isMobile ? "" : "Alt+4",
        c4,
        () => this.callbacks.onAdopt(c4, "alternative", item.sourceRange)
      );
    }
  }

  private renderCard(
    parent: HTMLElement,
    title: string,
    shortcut: string,
    text: string,
    onClick: () => void,
    subText?: string | null
  ) {
    const card = parent.createDiv({ cls: "diary-copilot-card" });
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });

    const badge = card.createDiv({ cls: "diary-copilot-card-badge" });
    badge.createSpan({ text: title });
    if (shortcut) {
      badge.createSpan({ cls: "key-hint", text: shortcut });
    }

    card.createDiv({ cls: "diary-copilot-card-text", text });

    if (subText) {
      card.createDiv({
        cls: "diary-copilot-card-translation-source",
        text: subText,
      });
    }
  }

  hide() {
    if (this.panelEl) {
      this.panelEl.addClass("is-hidden");
    }
  }

  show() {
    if (this.panelEl) {
      this.panelEl.removeClass("is-hidden");
    }
  }

  isHidden(): boolean {
    return !this.panelEl || this.panelEl.hasClass("is-hidden");
  }

  destroy() {
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }
}
