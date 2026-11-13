import { SuggestionItem } from "../types";

export function parsePartialSuggestion(raw: string): SuggestionItem | null {
  if (!raw || raw.trim().length === 0) return null;

  // First try standard JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        continueText: parsed.continue ? String(parsed.continue).trim() : "",
        alternativeText: parsed.alternative ? String(parsed.alternative).trim() : "",
        translationText: parsed.translation ? String(parsed.translation).trim() : null,
        translationSource: parsed.translation_source ? String(parsed.translation_source).trim() : null,
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

  const continueVal = extractField("continue", raw);
  const alternativeVal = extractField("alternative", raw);
  const translationVal = extractField("translation", raw);
  const translationSourceVal = extractField("translation_source", raw);

  if (continueVal || alternativeVal || translationVal) {
    return {
      continueText: continueVal.trim(),
      alternativeText: alternativeVal.trim(),
      translationText: translationVal ? translationVal.trim() : null,
      translationSource: translationSourceVal ? translationSourceVal.trim() : null,
    };
  }

  return null;
}
