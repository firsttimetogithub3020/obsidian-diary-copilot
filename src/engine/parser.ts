import { SuggestionItem } from "../types";

export function parsePartialSuggestion(raw: string): SuggestionItem | null {
  if (!raw || raw.trim().length === 0) return null;

  // First try standard JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const c1 = parsed.card1 || parsed.continue || parsed.option1 || "";
      const c2 = parsed.card2 || parsed.alternative || parsed.option2 || "";
      const c3 = parsed.card3 || parsed.translation || parsed.option3 || "";
      const c4 = parsed.card4 || parsed.option4 || "";

      return {
        card1: String(c1).trim(),
        card2: String(c2).trim(),
        card3: String(c3).trim(),
        card4: String(c4).trim(),
        continueText: String(c1).trim(),
        alternativeText: String(c2).trim(),
        translationText: c3 ? String(c3).trim() : null,
      };
    }
  } catch {
    // Incomplete JSON stream: fallback to regex extraction
  }

  // Regex extraction for streaming partial fields
  const extractField = (fieldName: string, text: string): string => {
    const regex = new RegExp(`"${fieldName}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)(?:"|$)`, "i");
    const match = text.match(regex);
    if (match && match[1]) {
      try {
        return JSON.parse(`"${match[1]}"`);
      } catch {
        return match[1].replace(/\\"/g, '"').replace(/\\n/g, " ");
      }
    }
    return "";
  };

  const c1 = extractField("card1", raw) || extractField("continue", raw) || extractField("option1", raw);
  const c2 = extractField("card2", raw) || extractField("alternative", raw) || extractField("option2", raw);
  const c3 = extractField("card3", raw) || extractField("translation", raw) || extractField("option3", raw);
  const c4 = extractField("card4", raw) || extractField("option4", raw);

  if (c1 || c2 || c3 || c4) {
    return {
      card1: c1.trim(),
      card2: c2.trim(),
      card3: c3.trim(),
      card4: c4.trim(),
      continueText: c1.trim(),
      alternativeText: c2.trim(),
      translationText: c3 ? c3.trim() : null,
    };
  }

  return null;
}
