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

  const len = docText.length;
  const clampedCursor = Math.max(0, Math.min(cursorOffset, len));

  // 1. Find line boundaries around the cursor
  let lineStart = docText.lastIndexOf("\n", Math.max(0, clampedCursor - 1));
  lineStart = lineStart === -1 ? 0 : lineStart + 1;

  let lineEnd = docText.indexOf("\n", clampedCursor);
  lineEnd = lineEnd === -1 ? len : lineEnd;

  let currentLine = docText.slice(lineStart, lineEnd);

  // If current line is completely empty or only whitespace, fallback to the previous non-empty line
  if (!currentLine.trim()) {
    let prevPos = lineStart - 1;
    while (prevPos >= 0 && /\s/.test(docText[prevPos])) {
      prevPos--;
    }
    if (prevPos < 0) return null;
    let prevLineStart = docText.lastIndexOf("\n", Math.max(0, prevPos - 1));
    prevLineStart = prevLineStart === -1 ? 0 : prevLineStart + 1;
    let prevLineEnd = docText.indexOf("\n", prevPos);
    prevLineEnd = prevLineEnd === -1 ? len : prevLineEnd;

    const prevLineText = docText.slice(prevLineStart, prevLineEnd).trim();
    if (!prevLineText) return null;

    const contextStart = Math.max(0, prevLineStart - 250);
    const contextEnd = Math.min(len, prevLineEnd + 250);
    return {
      sentence: prevLineText,
      from: prevLineStart,
      to: prevLineEnd,
      surroundingContext: docText.slice(contextStart, contextEnd),
    };
  }

  // 2. We have a non-empty line. Look for sentence boundaries within the line around cursor
  const relCursor = Math.max(0, Math.min(clampedCursor - lineStart, currentLine.length));

  let sentStartRel = 0;
  for (let i = relCursor - 1; i >= 0; i--) {
    if (/[.!?。！？]/.test(currentLine[i])) {
      sentStartRel = i + 1;
      break;
    }
  }
  while (sentStartRel < currentLine.length && /\s/.test(currentLine[sentStartRel])) {
    sentStartRel++;
  }

  let sentEndRel = currentLine.length;
  for (let i = Math.max(sentStartRel, relCursor); i < currentLine.length; i++) {
    if (/[.!?。！？]/.test(currentLine[i])) {
      sentEndRel = i + 1;
      break;
    }
  }

  const rawSentence = currentLine.slice(sentStartRel, sentEndRel).trim();
  const from = lineStart + sentStartRel;
  const to = lineStart + sentEndRel;

  if (rawSentence.length > 0) {
    const contextStart = Math.max(0, from - 250);
    const contextEnd = Math.min(len, to + 250);
    return {
      sentence: rawSentence,
      from,
      to,
      surroundingContext: docText.slice(contextStart, contextEnd),
    };
  }

  // Fallback to the whole line
  return {
    sentence: currentLine.trim(),
    from: lineStart,
    to: lineEnd,
    surroundingContext: docText.slice(Math.max(0, lineStart - 250), Math.min(len, lineEnd + 250)),
  };
}
