import { App, Platform } from "obsidian";
import { GeminiProvider } from "../llm/gemini";
import { forceDismissSoftKeyboard } from "./cardPanel";

export interface SelectionPopoverOptions {
  app: App;
  llm: GeminiProvider;
  isEnabled: () => boolean;
  onPolish?: (text: string) => void;
}

export class SelectionPopover {
  private app: App;
  private llm: GeminiProvider;
  private isEnabled: () => boolean;
  private onPolish?: (text: string) => void;

  private popoverEl: HTMLElement | null = null;
  private cache = new Map<string, { pos: string; translation: string }>();
  private activeRequestId = 0;
  private debounceTimer: number | null = null;
  private currentQueryText = "";

  constructor(options: SelectionPopoverOptions) {
    this.app = options.app;
    this.llm = options.llm;
    this.isEnabled = options.isEnabled;
    this.onPolish = options.onPolish;

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
        if (!this.popoverEl) return;
        const target = e.target as HTMLElement;
        if (this.popoverEl.contains(target)) return;
        window.setTimeout(() => {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed) {
            this.hide();
          }
        }, 120);
      },
      { passive: true }
    );
  }

  handleSelection(selectedText: string, rect: { left: number; top: number; right: number; bottom: number }) {
    if (!this.isEnabled()) {
      this.hide();
      return;
    }

    const cleanText = selectedText.trim().replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+|[^a-zA-Z0-9\u4e00-\u9fa5]+$/g, "");
    // Support words, phrases, and sentences up to 350 chars
    if (cleanText.length === 0 || cleanText.length > 350) {
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

    const contentDiv = this.popoverEl.createDiv({ cls: "popover-content" });

    // Query text badge
    const termSpan = contentDiv.createSpan({ cls: "popover-term" });
    termSpan.setText(text.length > 28 ? text.slice(0, 26) + "..." : text);

    if (isLoading) {
      const loadingSpan = contentDiv.createSpan({ cls: "popover-loading" });
      loadingSpan.setText(" ⏳ 查詢中...");
    } else if (result) {
      if (result.pos) {
        const posBadge = contentDiv.createSpan({ cls: "popover-pos" });
        posBadge.setText(result.pos);
      }

      const transSpan = contentDiv.createSpan({ cls: "popover-translation" });
      transSpan.setText(result.translation || "");
    }

    // Action buttons (Only Close button, no redundant polish button in lookup popover)
    const actions = this.popoverEl.createDiv({ cls: "popover-actions" });

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

    // Mobile adaptation: Dock popover cleanly right ABOVE the Copilot toolbar!
    // Never docked at the very top where text is too small or obscured by notch/status bar.
    if (Platform.isMobile) {
      this.popoverEl.addClass("is-mobile-docked");
      const copilotPanel = document.querySelector(".diary-copilot-panel") as HTMLElement;
      let bottomPx = 76;
      if (copilotPanel) {
        const panelRect = copilotPanel.getBoundingClientRect();
        if (panelRect.top > 0 && panelRect.top < window.innerHeight) {
          bottomPx = Math.max(76, Math.round(window.innerHeight - panelRect.top + 8));
        }
      }
      this.popoverEl.style.left = "10px";
      this.popoverEl.style.right = "10px";
      this.popoverEl.style.bottom = `${bottomPx}px`;
      this.popoverEl.style.top = "auto";
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

  isVisible(): boolean {
    return !!this.popoverEl;
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
