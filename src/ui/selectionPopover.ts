import { App, Platform } from "obsidian";
import { GeminiProvider } from "../llm/gemini";

export interface SelectionPopoverOptions {
  app: App;
  llm: GeminiProvider;
  isEnabled: () => boolean;
}

export class SelectionPopover {
  private app: App;
  private llm: GeminiProvider;
  private isEnabled: () => boolean;

  private popoverEl: HTMLElement | null = null;
  private cache = new Map<string, { pos: string; translation: string }>();
  private activeRequestId = 0;
  private debounceTimer: number | null = null;
  private currentQueryText = "";

  constructor(options: SelectionPopoverOptions) {
    this.app = options.app;
    this.llm = options.llm;
    this.isEnabled = options.isEnabled;

    this.setupGlobalDismissListeners();
  }

  private setupGlobalDismissListeners() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hide();
      }
    });

    window.addEventListener(
      "mousedown",
      (e) => {
        if (this.popoverEl && !this.popoverEl.contains(e.target as Node)) {
          this.hide();
        }
      },
      true
    );

    window.addEventListener(
      "touchstart",
      (e) => {
        if (this.popoverEl && !this.popoverEl.contains(e.target as Node)) {
          this.hide();
        }
      },
      { passive: true, capture: true }
    );
  }

  handleSelection(selectedText: string, rect: { left: number; top: number; right: number; bottom: number }) {
    if (!this.isEnabled()) {
      this.hide();
      return;
    }

    const cleanText = selectedText.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
    // Only lookup reasonable word or phrase lengths (1 to 80 chars, contains English letters)
    if (cleanText.length === 0 || cleanText.length > 80 || !/[a-zA-Z]/.test(cleanText)) {
      return;
    }

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.performLookup(cleanText, rect);
    }, 280);
  }

  private async performLookup(text: string, rect: { left: number; top: number; right: number; bottom: number }) {
    this.currentQueryText = text;
    const requestId = ++this.activeRequestId;

    this.renderPopover(text, rect, null, true);

    // Check cache
    const cached = this.cache.get(text.toLowerCase());
    if (cached) {
      this.renderPopover(text, rect, cached, false);
      return;
    }

    try {
      const result = await this.llm.lookupWordOrPhrase(text);
      if (requestId !== this.activeRequestId) return;

      if (result) {
        this.cache.set(text.toLowerCase(), result);
        this.renderPopover(text, rect, result, false);
      } else {
        this.renderPopover(text, rect, { pos: "", translation: "未找到簡明釋義" }, false);
      }
    } catch (err) {
      if (requestId !== this.activeRequestId) return;
      this.renderPopover(text, rect, { pos: "", translation: "查詢失敗" }, false);
    }
  }

  private renderPopover(
    text: string,
    rect: { left: number; top: number; right: number; bottom: number },
    result: { pos: string; translation: string } | null,
    isLoading: boolean
  ) {
    if (!this.popoverEl) {
      this.popoverEl = document.body.createDiv({ cls: "diary-copilot-selection-popover" });
    }

    this.popoverEl.empty();

    // Query text badge
    const termSpan = this.popoverEl.createSpan({ cls: "popover-term" });
    termSpan.setText(text.length > 25 ? text.slice(0, 22) + "..." : text);

    if (isLoading) {
      const loadingSpan = this.popoverEl.createSpan({ cls: "popover-loading" });
      loadingSpan.setText("⏳ 查詢中...");
    } else if (result) {
      if (result.pos) {
        const posBadge = this.popoverEl.createSpan({ cls: "popover-pos" });
        posBadge.setText(result.pos);
      }

      const transSpan = this.popoverEl.createSpan({ cls: "popover-translation" });
      transSpan.setText(result.translation || "");
    }

    // Action buttons
    const actions = this.popoverEl.createDiv({ cls: "popover-actions" });

    // Google Translate external search button
    const gtransBtn = actions.createEl("button", {
      cls: "popover-btn",
      text: "🌐 Google 翻譯",
      attr: { "aria-label": "在 Google 翻譯中開啟", title: "在 Google 翻譯中開啟完整釋義" },
    });
    gtransBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = `https://translate.google.com/?sl=auto&tl=zh-TW&text=${encodeURIComponent(text)}`;
      window.open(url, "_blank");
    });

    // Close button
    const closeBtn = actions.createEl("button", {
      cls: "popover-btn popover-close-btn",
      text: "✕",
      attr: { "aria-label": "關閉", title: "關閉" },
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });

    // Position calculation
    this.popoverEl.style.display = "flex";
    this.popoverEl.style.visibility = "hidden";

    // Mobile adaptation: Dock popover right above the bottom Copilot cards
    // This completely avoids overlapping with Android / iOS native "Copy / Share" action bars!
    if (Platform.isMobile) {
      this.popoverEl.addClass("is-mobile-docked");
      const panelEl = document.querySelector(".diary-copilot-panel:not(.is-hidden)") as HTMLElement | null;
      let bottomPx = 16;
      if (panelEl) {
        const panelRect = panelEl.getBoundingClientRect();
        if (panelRect.height > 0 && panelRect.top < window.innerHeight) {
          bottomPx = Math.max(16, window.innerHeight - panelRect.top + 10);
        }
      }
      this.popoverEl.style.left = "10px";
      this.popoverEl.style.right = "10px";
      this.popoverEl.style.top = "auto";
      this.popoverEl.style.bottom = `${Math.round(bottomPx)}px`;
      this.popoverEl.style.visibility = "visible";
      return;
    }

    // Desktop: traditional floating tooltip right above the selected word
    this.popoverEl.removeClass("is-mobile-docked");
    this.popoverEl.style.bottom = "auto";
    const popoverRect = this.popoverEl.getBoundingClientRect();
    const popWidth = popoverRect.width || 220;
    const popHeight = popoverRect.height || 36;

    let targetLeft = rect.left;
    // Prevent overflowing right edge
    if (targetLeft + popWidth > window.innerWidth - 12) {
      targetLeft = window.innerWidth - popWidth - 12;
    }
    if (targetLeft < 12) {
      targetLeft = 12;
    }

    // Prefer placing above selection; fallback below if too close to top
    let targetTop = rect.top - popHeight - 8;
    if (targetTop < 40) {
      targetTop = rect.bottom + 8;
    }
    if (targetTop + popHeight > window.innerHeight - 8) {
      targetTop = window.innerHeight - popHeight - 8;
    }

    this.popoverEl.style.left = `${Math.round(targetLeft)}px`;
    this.popoverEl.style.top = `${Math.round(targetTop)}px`;
    this.popoverEl.style.visibility = "visible";
  }

  hide() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.activeRequestId++;
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
  }

  destroy() {
    this.hide();
    this.cache.clear();
  }
}
