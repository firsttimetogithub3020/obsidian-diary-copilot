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
  const textBeforeCursor = docText.slice(0, cursorOffset);

  const allSentences = textBeforeCursor
    .split(SENTENCE_SPLIT_REGEX)
    .map((s) => s.trim())
    .filter(Boolean);

  const currentSentence = allSentences.length > 0 ? allSentences[allSentences.length - 1] : "";
  const recentSentences = allSentences.slice(Math.max(0, allSentences.length - 4), Math.max(0, allSentences.length - 1));

  // Check for Chinese in current line before cursor
  const lastNewlinePos = textBeforeCursor.lastIndexOf("\n");
  const lineStartPos = lastNewlinePos === -1 ? 0 : lastNewlinePos + 1;
  const currentLineBeforeCursor = docText.slice(lineStartPos, cursorOffset);

  let chineseSegment: string | undefined = undefined;
  let chineseRange: { from: number; to: number } | undefined = undefined;

  if (CHINESE_CHAR_REGEX.test(currentLineBeforeCursor)) {
    // Find all Chinese occurrences in the line
    const matches = Array.from(currentLineBeforeCursor.matchAll(/[\u4e00-\u9fa5，。！？、…]+/g));
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const matchIndex = lastMatch.index ?? -1;

      if (matchIndex !== -1) {
        const chineseStr = lastMatch[0].trim();
        const textAfterChinese = currentLineBeforeCursor.slice(matchIndex + lastMatch[0].length);

        // If the Chinese is within the recent 80 characters before cursor
        if (textAfterChinese.length < 80) {
          chineseSegment = chineseStr;
          const from = lineStartPos + matchIndex;
          let matchEnd = matchIndex + lastMatch[0].length;
          // Include immediately following spaces up to cursor
          while (matchEnd < currentLineBeforeCursor.length && /\s/.test(currentLineBeforeCursor[matchEnd])) {
            matchEnd++;
          }
          const to = lineStartPos + matchEnd;
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

  let searchPos = Math.min(cursorOffset, docText.length);
  while (searchPos > 0 && /\s/.test(docText[searchPos - 1])) {
    searchPos--;
  }

  if (searchPos <= 0) return null;

  let from = 0;
  for (let i = searchPos - 1; i >= 0; i--) {
    const ch = docText[i];
    if (/[.!?。！？\n]/.test(ch)) {
      from = i + 1;
      break;
    }
  }

  while (from < docText.length && /\s/.test(docText[from])) {
    from++;
  }

  let to = docText.length;
  for (let i = searchPos; i < docText.length; i++) {
    const ch = docText[i];
    if (/[.!?。！？\n]/.test(ch)) {
      to = i + 1;
      break;
    }
  }

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
