export interface PrefixMatchResult {
  matched: boolean;
  remainingContinueText: string;
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

  const typedLower = typedTrimmed.toLowerCase();
  const targetLower = targetTrimmed.toLowerCase();

  if (targetLower.startsWith(typedLower)) {
    const remaining = targetTrimmed.slice(typedTrimmed.length);
    return {
      matched: true,
      remainingContinueText: remaining,
    };
  }

  return { matched: false, remainingContinueText: "" };
}
