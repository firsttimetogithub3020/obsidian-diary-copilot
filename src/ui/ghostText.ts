import { EditorView, WidgetType, Decoration, DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

export interface GhostTextPayload {
  targetText: string;
  anchorPos: number;
}

export const setGhostTextEffect = StateEffect.define<GhostTextPayload | null>();

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "diary-copilot-ghost-text";
    span.textContent = this.text;
    return span;
  }
}

export interface GhostTextState {
  targetText: string | null;
  anchorPos: number;
  deco: DecorationSet;
}

export function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u00A0\u2000-\u200B]/g, " ");
}

export const ghostTextField = StateField.define<GhostTextState>({
  create() {
    return { targetText: null, anchorPos: 0, deco: Decoration.none };
  },
  update(state, tr) {
    let targetText = state.targetText;
    let anchorPos = state.anchorPos;

    for (const e of tr.effects) {
      if (e.is(setGhostTextEffect)) {
        if (e.value === null) {
          return { targetText: null, anchorPos: 0, deco: Decoration.none };
        }
        targetText = e.value.targetText;
        anchorPos = e.value.anchorPos;
      }
    }

    if (!targetText || targetText.length === 0) {
      return { targetText: null, anchorPos: 0, deco: Decoration.none };
    }

    const cursor = tr.state.selection.main.head;

    // If cursor moved before the anchor position, user backspaced or clicked away
    if (cursor < anchorPos) {
      return { targetText: null, anchorPos: 0, deco: Decoration.none };
    }

    const typed = tr.state.doc.sliceString(anchorPos, cursor);

    // Trigger 2: If newline is entered (Enter key), abandon ghost text immediately
    if (typed.includes("\n")) {
      return { targetText: null, anchorPos: 0, deco: Decoration.none };
    }

    const targetTrimmed = targetText.trimStart();
    const typedTrimmed = typed.trimStart();

    // User hasn't typed non-whitespace characters yet
    if (typedTrimmed.length === 0) {
      let displayText = targetText;
      if (cursor > 0) {
        const prevChar = tr.state.doc.sliceString(cursor - 1, cursor);
        if (!/\s/.test(prevChar) && !displayText.startsWith(" ") && !displayText.startsWith("\n")) {
          displayText = " " + displayText;
        } else if (/\s/.test(prevChar) && displayText.startsWith(" ")) {
          displayText = displayText.trimStart();
        }
      }

      if (displayText.length === 0) {
        return { targetText: null, anchorPos: 0, deco: Decoration.none };
      }

      const widget = Decoration.widget({
        widget: new GhostTextWidget(displayText),
        side: 1,
      });

      return {
        targetText,
        anchorPos,
        deco: Decoration.set([widget.range(cursor)]),
      };
    }

    // Compare prefix case-insensitively & quote-normalized
    const targetNorm = normalizeForComparison(targetTrimmed);
    const typedNorm = normalizeForComparison(typedTrimmed);

    if (targetNorm.startsWith(typedNorm)) {
      const remaining = targetTrimmed.slice(typedTrimmed.length);

      if (remaining.length === 0) {
        // Trigger 1: Completed typing entire ghost text
        return { targetText: null, anchorPos: 0, deco: Decoration.none };
      }

      const widget = Decoration.widget({
        widget: new GhostTextWidget(remaining),
        side: 1,
      });

      return {
        targetText,
        anchorPos,
        deco: Decoration.set([widget.range(cursor)]),
      };
    }

    // Typo / Mismatched characters:
    // Retain targetText & anchorPos so Backspace immediately brings ghost text back!
    // Hide decoration while mismatched so it doesn't collide with the typo.
    return { targetText, anchorPos, deco: Decoration.none };
  },
  provide: (f) => EditorView.decorations.from(f, (val) => val.deco),
});
