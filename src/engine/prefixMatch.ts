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

  const normalizedTyped = typedDiff.toLowerCase();
  const normalizedTarget = fullContinueText.toLowerCase();

  // If typed text directly matches the start of the prediction
  if (normalizedTarget.startsWith(normalizedTyped)) {
    return {
      matched: true,
      remainingContinueText: fullContinueText.slice(typedDiff.length),
    };
  }

  // Also check if typed has leading space matching or non-space matching
  const trimmedTyped = normalizedTyped.trimStart();
  const trimmedTarget = normalizedTarget.trimStart();
  if (trimmedTyped.length > 0 && trimmedTarget.startsWith(trimmedTyped)) {
    const diffLength = fullContinueText.length - (trimmedTarget.length - trimmedTyped.length);
    return {
      matched: true,
      remainingContinueText: fullContinueText.slice(Math.max(0, diffLength)),
    };
  }

  return { matched: false, remainingContinueText: "" };
}
