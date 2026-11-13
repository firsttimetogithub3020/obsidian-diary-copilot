export interface ExtractedContext {
  currentSentence: string;
  recentSentences: string[];
  chineseSegment?: string;
  chineseRange?: { from: number; to: number };
  cursorOffset: number;
  fullDocText: string;
}

export interface SentenceToPolish {
  sentence: string;
  from: number;
  to: number;
  surroundingContext: string;
}

const SENTENCE_SPLIT_REGEX = /(?<=[.!?。！？\n])\s+/;
const CHINESE_CHAR_REGEX = /[\u4e00-\u9fa5]/;

export function extractContextFromDoc(docText: string, cursorOffset: number): ExtractedContext {
  // Extract text up to cursor
  const textBeforeCursor = docText.slice(0, cursorOffset);

  // Split into sentences
  const allSentences = textBeforeCursor
    .split(SENTENCE_SPLIT_REGEX)
    .map((s) => s.trim())
    .filter(Boolean);

  const currentSentence = allSentences.length > 0 ? allSentences[allSentences.length - 1] : "";
  const recentSentences = allSentences.slice(Math.max(0, allSentences.length - 4), Math.max(0, allSentences.length - 1));

  // Check for Chinese in current line / nearby cursor
  const lastNewlinePos = textBeforeCursor.lastIndexOf("\n");
  const lineStartPos = lastNewlinePos === -1 ? 0 : lastNewlinePos + 1;
  const currentLineBeforeCursor = docText.slice(lineStartPos, cursorOffset);

  let chineseSegment: string | undefined = undefined;
  let chineseRange: { from: number; to: number } | undefined = undefined;

  if (CHINESE_CHAR_REGEX.test(currentLineBeforeCursor)) {
    // Find continuous Chinese (including punctuation)
    const chineseMatch = currentLineBeforeCursor.match(/[\u4e00-\u9fa5，。！？、…\s]{2,}/g);
    if (chineseMatch && chineseMatch.length > 0) {
      const target = chineseMatch[chineseMatch.length - 1].trim();
      if (target.length > 0 && CHINESE_CHAR_REGEX.test(target)) {
        chineseSegment = target;
        const relativeStart = currentLineBeforeCursor.lastIndexOf(target);
        if (relativeStart !== -1) {
          const from = lineStartPos + relativeStart;
          const to = from + target.length;
          chineseRange = { from, to };
        }
      }
    }
  }

  return {
    currentSentence,
    recentSentences,
    chineseSegment,
    chineseRange,
    cursorOffset,
    fullDocText: docText,
  };
}

export function extractSentenceToPolish(docText: string, cursorOffset: number): SentenceToPolish | null {
  if (!docText || docText.trim().length === 0) return null;

  // Search backwards from cursor for start of sentence
  let searchPos = Math.min(cursorOffset, docText.length);
  // If cursor is at whitespace or newline, backtrack to last non-whitespace
  while (searchPos > 0 && /\s/.test(docText[searchPos - 1])) {
    searchPos--;
  }

  if (searchPos <= 0) return null;

  // Find sentence start (after previous .!?\n)
  let from = 0;
  for (let i = searchPos - 1; i >= 0; i--) {
    const ch = docText[i];
    if (/[.!?。！？\n]/.test(ch)) {
      from = i + 1;
      break;
    }
  }

  // Skip leading whitespace in sentence
  while (from < docText.length && /\s/.test(docText[from])) {
    from++;
  }

  // Find sentence end (next .!?\n or doc end)
  let to = docText.length;
  for (let i = searchPos; i < docText.length; i++) {
    const ch = docText[i];
    if (/[.!?。！？\n]/.test(ch)) {
      to = i + 1;
      break;
    }
  }

  // If sentence hasn't ended with punctuation yet, sentence ends at cursor or current line end
  if (to > cursorOffset && !/[.!?。！？]/.test(docText.slice(from, to))) {
    to = cursorOffset;
  }

  const sentence = docText.slice(from, to).trim();
  if (!sentence) return null;

  const contextStart = Math.max(0, from - 250);
  const contextEnd = Math.min(docText.length, to + 250);
  const surroundingContext = docText.slice(contextStart, contextEnd);

  return {
    sentence,
    from,
    to,
    surroundingContext,
  };
}
