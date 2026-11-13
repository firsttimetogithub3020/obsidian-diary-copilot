import { Prec } from "@codemirror/state";
import { keymap, Command } from "@codemirror/view";
import { SuggestionItem } from "../types";

export interface KeymapCallbacks {
  getCurrentSuggestion: () => SuggestionItem | null;
  onAdopt: (text: string, kind: "continue" | "alternative" | "translation", sourceRange?: { from: number; to: number }) => void;
  onDismiss: () => void;
  onPolishRequest?: () => void;
}

export function createDiaryKeymap(callbacks: KeymapCallbacks) {
  const acceptCard1: Command = () => {
    const item = callbacks.getCurrentSuggestion();
    if (item && item.continueText) {
      callbacks.onAdopt(item.continueText, "continue", item.sourceRange);
      return true;
    }
    return false;
  };

  const acceptCard2: Command = () => {
    const item = callbacks.getCurrentSuggestion();
    if (item && item.alternativeText) {
      callbacks.onAdopt(item.alternativeText, "alternative", item.sourceRange);
      return true;
    }
    return false;
  };

  const acceptCard3: Command = () => {
    const item = callbacks.getCurrentSuggestion();
    if (item && item.translationText) {
      callbacks.onAdopt(item.translationText, "translation", item.sourceRange);
      return true;
    }
    return false;
  };

  const dismiss: Command = () => {
    const item = callbacks.getCurrentSuggestion();
    if (item) {
      callbacks.onDismiss();
      return true;
    }
    return false;
  };

  const polish: Command = () => {
    if (callbacks.onPolishRequest) {
      callbacks.onPolishRequest();
      return true;
    }
    return false;
  };

  return Prec.highest(
    keymap.of([
      { key: "Tab", run: acceptCard1 },
      { key: "Alt-1", run: acceptCard1 },
      { key: "Alt-2", run: acceptCard2 },
      { key: "Alt-3", run: acceptCard3 },
      { key: "Escape", run: dismiss },
      { key: "F3", run: polish },
    ])
  );
}
