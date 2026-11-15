import { SuggestionItem, InquiryItem } from "../types";

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

export function parseInquiryResponse(raw: string): InquiryItem | null {
  if (!raw || raw.trim().length === 0) return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      return {
        closedQuestion: String(parsed.closedQuestion || "").trim(),
        closedChinese: parsed.closedChinese ? String(parsed.closedChinese).trim() : undefined,
        yes1: String(parsed.yes1 || "").trim(),
        yes2: String(parsed.yes2 || "").trim(),
        no1: String(parsed.no1 || "").trim(),
        no2: String(parsed.no2 || "").trim(),
        openQuestion: String(parsed.openQuestion || "").trim(),
        openChinese: parsed.openChinese ? String(parsed.openChinese).trim() : undefined,
        openStyle1: String(parsed.openStyle1 || "").trim(),
        openStyle2: String(parsed.openStyle2 || "").trim(),
        openStyle3: String(parsed.openStyle3 || "").trim(),
        openStyle4: String(parsed.openStyle4 || "").trim(),
      };
    }
  } catch {
    // If JSON parsing fails, regex fallback
    const extract = (field: string): string => {
      const match = cleaned.match(new RegExp(`"${field}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, "i"));
      return match ? match[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim() : "";
    };

    const cq = extract("closedQuestion");
    const oq = extract("openQuestion");
    if (cq || oq) {
      return {
        closedQuestion: cq,
        closedChinese: extract("closedChinese") || undefined,
        yes1: extract("yes1"),
        yes2: extract("yes2"),
        no1: extract("no1"),
        no2: extract("no2"),
        openQuestion: oq,
        openChinese: extract("openChinese") || undefined,
        openStyle1: extract("openStyle1"),
        openStyle2: extract("openStyle2"),
        openStyle3: extract("openStyle3"),
        openStyle4: extract("openStyle4"),
      };
    }
  }
  return null;
}
