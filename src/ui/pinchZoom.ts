export interface PinchZoomOptions {
  containerEl: HTMLElement;
  initialSize: number;
  minSize?: number;
  maxSize?: number;
  cssVariable: string;
  onSizeChange?: (newSize: number) => void;
  showIndicator?: boolean;
}

export interface PinchZoomController {
  cleanup: () => void;
  getSize: () => number;
  setSize: (newSize: number) => void;
}

/**
 * Sets up pinch-to-zoom (touch gesture) and Ctrl+Wheel on mobile / desktop.
 * Single finger scrolling remains 100% unhindered.
 */
export function setupPinchZoom(options: PinchZoomOptions): PinchZoomController {
  const minSize = options.minSize ?? 12;
  const maxSize = options.maxSize ?? 32;
  let currentSize = Math.max(minSize, Math.min(maxSize, options.initialSize));
  const container = options.containerEl;

  // Apply initial size
  container.style.setProperty(options.cssVariable, `${currentSize}px`);

  // Floating Indicator
  let indicatorEl: HTMLElement | null = null;
  let indicatorTimer: number | null = null;

  if (options.showIndicator !== false) {
    indicatorEl = container.createDiv({ cls: "diary-copilot-zoom-indicator" });
  }

  const showIndicator = (size: number) => {
    if (!indicatorEl) return;
    indicatorEl.setText(`🔤 ${size}px`);
    indicatorEl.addClass("is-visible");
    if (indicatorTimer) window.clearTimeout(indicatorTimer);
    indicatorTimer = window.setTimeout(() => {
      indicatorEl?.removeClass("is-visible");
    }, 1200);
  };

  const updateSize = (newSize: number, inform = true) => {
    const clamped = Math.max(minSize, Math.min(maxSize, parseFloat(newSize.toFixed(1))));
    currentSize = clamped;
    container.style.setProperty(options.cssVariable, `${currentSize}px`);
    showIndicator(currentSize);
    if (inform) {
      options.onSizeChange?.(currentSize);
    }
  };

  let isPinching = false;
  let startDistance = 0;
  let startFontSize = currentSize;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      // 2 fingers detected: start pinch
      isPinching = true;
      startDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      startFontSize = currentSize;
      if (e.cancelable) e.preventDefault();
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (isPinching && e.touches.length === 2) {
      if (e.cancelable) e.preventDefault();
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (startDistance > 0) {
        const scale = currentDistance / startDistance;
        const target = Math.round(startFontSize * scale * 2) / 2;
        updateSize(target, false);
      }
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (isPinching && e.touches.length < 2) {
      isPinching = false;
      options.onSizeChange?.(currentSize);
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.5 : 0.5;
      updateSize(currentSize + delta, true);
    }
  };

  container.addEventListener("touchstart", onTouchStart, { passive: false });
  container.addEventListener("touchmove", onTouchMove, { passive: false });
  container.addEventListener("touchend", onTouchEnd);
  container.addEventListener("touchcancel", onTouchEnd);
  container.addEventListener("wheel", onWheel, { passive: false });

  return {
    cleanup: () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      container.removeEventListener("wheel", onWheel);
      if (indicatorTimer) window.clearTimeout(indicatorTimer);
      if (indicatorEl) indicatorEl.remove();
    },
    getSize: () => currentSize,
    setSize: (s: number) => updateSize(s, true),
  };
}
