export class FloatingCapsule {
  private dom: HTMLElement;
  private badgeEl: HTMLElement;
  private textEl: HTMLElement;
  private hintEl: HTMLElement;
  private parentEl: HTMLElement;
  private isVisible = false;

  constructor(parentEl: HTMLElement) {
    this.parentEl = parentEl;
    this.dom = document.createElement("div");
    this.dom.className = "diary-copilot-floating-capsule is-hidden";

    this.badgeEl = this.dom.createDiv({ cls: "diary-copilot-floating-capsule-badge" });
    this.badgeEl.textContent = "💡 建議表達 · 跟寫練習";

    this.textEl = this.dom.createDiv({ cls: "diary-copilot-floating-capsule-text" });

    this.hintEl = this.dom.createDiv({ cls: "diary-copilot-floating-capsule-hint" });
    this.hintEl.textContent = "照著打完或按 Tab 完成，中文將自動清除";

    this.parentEl.appendChild(this.dom);
  }

  show(text: string, clientX: number, clientY: number) {
    if (!text || text.trim().length === 0) {
      this.hide();
      return;
    }

    this.textEl.textContent = text;
    this.dom.removeClass("is-hidden");
    this.isVisible = true;

    // Position relative to parent container
    const parentRect = this.parentEl.getBoundingClientRect();
    let left = clientX - parentRect.left;
    let top = clientY - parentRect.top + 8;

    // Prevent overflowing right boundary
    const capsuleWidth = 380;
    if (left + capsuleWidth > parentRect.width) {
      left = Math.max(10, parentRect.width - capsuleWidth - 20);
    }

    this.dom.style.left = `${Math.max(10, left)}px`;
    this.dom.style.top = `${top}px`;
  }

  hide() {
    if (!this.isVisible) return;
    this.dom.addClass("is-hidden");
    this.isVisible = false;
  }

  destroy() {
    this.dom.remove();
  }
}
