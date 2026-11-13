export interface ExtractedContext {
  currentSentence: string;
  recentSentences: string[];
  chineseSegment?: string;
  chineseRange?: { from: number; to: number };
  cursorOffset: number;
  fullDocText: string;
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
