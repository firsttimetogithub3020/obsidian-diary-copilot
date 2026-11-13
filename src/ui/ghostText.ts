import { EditorView, WidgetType, Decoration, DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

export const setGhostTextEffect = StateEffect.define<string | null>();

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

export const ghostTextField = StateField.define<{ text: string | null; deco: DecorationSet }>({
  create() {
    return { text: null, deco: Decoration.none };
  },
  update(state, tr) {
    let currentText = state.text;

    for (const e of tr.effects) {
      if (e.is(setGhostTextEffect)) {
        currentText = e.value;
      }
    }

    if (!currentText || currentText.trim().length === 0) {
      return { text: null, deco: Decoration.none };
    }

    // Place widget at current cursor head
    const pos = tr.state.selection.main.head;
    const doc = tr.state.doc;

    // Check if leading space is needed
    let displayText = currentText;
    if (pos > 0) {
      const prevChar = doc.sliceString(pos - 1, pos);
      if (!/\s/.test(prevChar) && !displayText.startsWith(" ") && !displayText.startsWith("\n")) {
        displayText = " " + displayText;
      } else if (/\s/.test(prevChar) && displayText.startsWith(" ")) {
        displayText = displayText.trimStart();
      }
    }

    if (displayText.length === 0) {
      return { text: null, deco: Decoration.none };
    }

    const widget = Decoration.widget({
      widget: new GhostTextWidget(displayText),
      side: 1,
    });

    return {
      text: currentText,
      deco: Decoration.set([widget.range(pos)]),
    };
  },
  provide: (f) => EditorView.decorations.from(f, (val) => val.deco),
});
