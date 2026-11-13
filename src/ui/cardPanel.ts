import { Platform } from "obsidian";
import { SuggestionItem } from "../types";

export interface CardPanelCallbacks {
  onAdopt: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onDismiss: () => void;
  onHeightResize?: (newHeight: number) => void;
}

export class CardPanel {
  private containerEl: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private statusDotEl: HTMLElement | null = null;
  private headerHintEl: HTMLElement | null = null;
  private cardsRowEl: HTMLElement | null = null;
  private resizeHandleEl: HTMLElement | null = null;
  private callbacks: CardPanelCallbacks;
  private currentItem: SuggestionItem | null = null;
  private isResizing = false;

  constructor(containerEl: HTMLElement, callbacks: CardPanelCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.render();
  }

  private render() {
    this.panelEl = this.containerEl.createDiv({ cls: "diary-copilot-panel is-hidden" });
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

    this.headerHintEl = header.createSpan({ cls: "diary-copilot-hint" });
    this.headerHintEl.setText(Platform.isMobile ? "點擊卡片採納" : "Alt+1/2/3/4 或點擊卡片採納 · Esc 關閉");

    // Cards row (4 columns)
    this.cardsRowEl = this.panelEl.createDiv({ cls: "diary-copilot-cards-row" });
  }

  private setupResizeListeners() {
    if (!this.resizeHandleEl || Platform.isMobile) return;

    this.resizeHandleEl.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!this.panelEl) return;
      this.isResizing = true;
      this.panelEl.addClass("is-resizing");

      const startY = e.clientY;
      const startHeight = this.panelEl.getBoundingClientRect().height;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!this.isResizing || !this.panelEl) return;
        const diffY = startY - moveEvent.clientY; // Dragging UP increases height
        const newHeight = Math.round(Math.max(80, Math.min(window.innerHeight * 0.7, startHeight + diffY)));

        this.panelEl.style.height = `${newHeight}px`;
        document.body.style.setProperty("--diary-copilot-panel-height", `${newHeight}px`);
      };

      const onMouseUp = () => {
        if (!this.isResizing) return;
        this.isResizing = false;
        this.panelEl?.removeClass("is-resizing");

        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);

        if (this.panelEl) {
          const finalHeight = Math.round(this.panelEl.getBoundingClientRect().height);
          if (this.callbacks.onHeightResize) {
            this.callbacks.onHeightResize(finalHeight);
          }
        }
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
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

  setError() {
    if (!this.panelEl) return;
    this.panelEl.addClass("is-hidden");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot error";
    }
  }

  updateSuggestions(item: SuggestionItem | null, isPolishMode = false) {
    this.currentItem = item;
    if (!this.panelEl || !this.cardsRowEl) return;

    if (!item || (!item.card1 && !item.card2 && !item.card3 && !item.card4 && !item.continueText)) {
      this.panelEl.addClass("is-hidden");
      return;
    }

    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }

    const hasChineseSource = !!(item.sourceRange && item.translationSource);
    const isShadowTyping = !isPolishMode && !hasChineseSource && !c2 && !c3 && !c4 && !!c1;

    if (this.headerHintEl) {
      if (isShadowTyping) {
        this.headerHintEl.setText("✍️ 跟寫練習中：請跟著編輯器內的灰字輸入，按 Esc 可取消");
      } else if (isPolishMode) {
        this.headerHintEl.setText("✨ F3 潤飾模式：按 Alt+1 / Alt+2 / Alt+3 / Alt+4 或點擊卡片跟寫");
      } else if (hasChineseSource) {
        this.headerHintEl.setText(`💡 中翻英：按 Alt+1/2/3/4 或點擊卡片，消除【${item.translationSource}】並變灰字跟寫`);
      } else {
        this.headerHintEl.setText(Platform.isMobile ? "點擊卡片跟寫" : "F3 潤飾 · Alt+1/2/3/4 或點擊卡片跟寫 · Esc 關閉");
      }
    }

    this.cardsRowEl.empty();

    if (isShadowTyping) {
      this.cardsRowEl.addClass("is-shadow-typing");
      this.renderCard(
        this.cardsRowEl,
        "✍️ 跟寫練習中 (目標句子)",
        "跟寫中",
        c1,
        () => {},
        "直接在編輯器輸入英文字母，灰字會同步匹配"
      );
      return;
    }

    this.cardsRowEl.removeClass("is-shadow-typing");

    const c1 = item.card1 || item.continueText || "";
    const c2 = item.card2 || item.alternativeText || "";
    const c3 = item.card3 || item.translationText || "";
    const c4 = item.card4 || "";

    if (isPolishMode) {
      if (c1) {
        this.renderCard(
          this.cardsRowEl,
          "💡 潤飾 1 · 自然口語",
          Platform.isMobile ? "" : "Alt+1",
          c1,
          () => this.callbacks.onAdopt(c1, "translation", item.sourceRange),
          `原句：${item.translationSource}`
        );
      }
      if (c2) {
        this.renderCard(
          this.cardsRowEl,
          "✨ 潤飾 2 · 地道生動",
          Platform.isMobile ? "" : "Alt+2",
          c2,
          () => this.callbacks.onAdopt(c2, "translation", item.sourceRange),
          `原句：${item.translationSource}`
        );
      }
      if (c3) {
        this.renderCard(
          this.cardsRowEl,
          "⚡ 潤飾 3 · 精煉有力",
          Platform.isMobile ? "" : "Alt+3",
          c3,
          () => this.callbacks.onAdopt(c3, "translation", item.sourceRange),
          `原句：${item.translationSource}`
        );
      }
      if (c4) {
        this.renderCard(
          this.cardsRowEl,
          "🎯 潤飾 4 · 優雅反思",
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
          "💡 卡 1 · 自然口語",
          Platform.isMobile ? "" : "Alt+1",
          c1,
          () => this.callbacks.onAdopt(c1, "translation", item.sourceRange),
          `消除：${item.translationSource}`
        );
      }

      if (c2) {
        this.renderCard(
          this.cardsRowEl,
          "✨ 卡 2 · 地道片語",
          Platform.isMobile ? "" : "Alt+2",
          c2,
          () => this.callbacks.onAdopt(c2, "translation", item.sourceRange),
          `消除：${item.translationSource}`
        );
      }

      if (c3) {
        this.renderCard(
          this.cardsRowEl,
          "⚡ 卡 3 · 精煉簡潔",
          Platform.isMobile ? "" : "Alt+3",
          c3,
          () => this.callbacks.onAdopt(c3, "translation", item.sourceRange),
          `消除：${item.translationSource}`
        );
      }

      if (c4) {
        this.renderCard(
          this.cardsRowEl,
          "🎯 卡 4 · 換種句式",
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

  destroy() {
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }
}
