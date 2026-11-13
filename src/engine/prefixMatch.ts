export interface PrefixMatchResult {
  matched: boolean;
  remainingContinueText: string;
}

export function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u00A0\u2000-\u200B]/g, " ");
}

export function tryMatchPrefix(typedDiff: string, fullContinueText: string): PrefixMatchResult {
  if (!fullContinueText || fullContinueText.trim().length === 0) {
    return { matched: false, remainingContinueText: "" };
  }

  if (!typedDiff || typedDiff.length === 0) {
    return { matched: true, remainingContinueText: fullContinueText };
  }

  // Strip leading spaces on both sides to align correctly
  const typedTrimmed = typedDiff.trimStart();
  const targetTrimmed = fullContinueText.trimStart();

  // If user only typed spaces so far (e.g. hitting spacebar right after preceding word)
  if (typedTrimmed.length === 0) {
    return {
      matched: true,
      remainingContinueText: targetTrimmed,
    };
  }

  const typedNorm = normalizeForComparison(typedTrimmed);
  const targetNorm = normalizeForComparison(targetTrimmed);

  if (targetNorm.startsWith(typedNorm)) {
    const remaining = targetTrimmed.slice(typedTrimmed.length);
    return {
      matched: true,
      remainingContinueText: remaining,
    };
  }

  return { matched: false, remainingContinueText: "" };
}
