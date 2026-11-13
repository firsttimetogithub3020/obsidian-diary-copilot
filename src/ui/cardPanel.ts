import { Platform } from "obsidian";
import { SuggestionItem } from "../types";

export interface CardPanelCallbacks {
  onAdopt: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onDismiss: () => void;
}

export class CardPanel {
  private containerEl: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private statusDotEl: HTMLElement | null = null;
  private cardsRowEl: HTMLElement | null = null;
  private callbacks: CardPanelCallbacks;
  private currentItem: SuggestionItem | null = null;

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

    // Top status bar
    const header = this.panelEl.createDiv({ cls: "diary-copilot-panel-header" });
    const brand = header.createDiv({ cls: "diary-copilot-brand" });
    this.statusDotEl = brand.createSpan({ cls: "diary-copilot-status-dot" });
    brand.createSpan({ text: "Diary Copilot" });

    const hint = header.createSpan({ cls: "diary-copilot-hint" });
    hint.setText(Platform.isMobile ? "點擊卡片採納" : "Tab 採納卡 1 · Alt+1/2/3 · Esc 關閉");

    // Cards row
    this.cardsRowEl = this.panelEl.createDiv({ cls: "diary-copilot-cards-row" });
  }

  setLoading() {
    if (!this.panelEl) return;
    this.panelEl.removeClass("is-hidden");
    this.panelEl.addClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot loading";
    }
  }

  setError() {
    if (!this.panelEl) return;
    this.panelEl.addClass("is-hidden");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot error";
    }
  }

  updateSuggestions(item: SuggestionItem | null) {
    this.currentItem = item;
    if (!this.panelEl || !this.cardsRowEl) return;

    if (!item || (!item.continueText && !item.alternativeText && !item.translationText)) {
      this.panelEl.addClass("is-hidden");
      return;
    }

    this.panelEl.removeClass("is-hidden");
    this.panelEl.removeClass("is-loading");
    if (this.statusDotEl) {
      this.statusDotEl.className = "diary-copilot-status-dot";
    }

    this.cardsRowEl.empty();

    // Card 1: Continue / Predict Next
    if (item.continueText) {
      this.renderCard(
        this.cardsRowEl,
        "卡 1 · 猜下一句",
        Platform.isMobile ? "" : "Tab",
        item.continueText,
        () => this.callbacks.onAdopt(item.continueText, "continue")
      );
    }

    // Card 2: Alternative direction / Splitting
    if (item.alternativeText) {
      this.renderCard(
        this.cardsRowEl,
        "卡 2 · 換個方向",
        Platform.isMobile ? "" : "Alt+2",
        item.alternativeText,
        () => this.callbacks.onAdopt(item.alternativeText, "alternative")
      );
    }

    // Card 3: Chinese -> English
    if (item.translationText) {
      this.renderCard(
        this.cardsRowEl,
        "卡 3 · 中 → 英",
        Platform.isMobile ? "" : "Alt+3",
        item.translationText,
        () => this.callbacks.onAdopt(item.translationText!, "translation", item.sourceRange),
        item.translationSource
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

    const content = card.createDiv({ cls: "diary-copilot-card-text", text });

    if (subText) {
      card.createDiv({
        cls: "diary-copilot-card-translation-source",
        text: `原文：${subText}`,
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
