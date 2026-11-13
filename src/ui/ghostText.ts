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
    span.textContent = this.text.startsWith(" ") || this.text.startsWith("\n") ? this.text : " " + this.text;
    return span;
  }
}

export const ghostTextField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const e of tr.effects) {
      if (e.is(setGhostTextEffect)) {
        if (!e.value) {
          return Decoration.none;
        }
        const pos = tr.state.selection.main.head;
        const widget = Decoration.widget({
          widget: new GhostTextWidget(e.value),
          side: 1,
        });
        return Decoration.set([widget.range(pos)]);
      }
    }

    if (tr.docChanged || tr.selection) {
      return Decoration.none;
    }

    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
