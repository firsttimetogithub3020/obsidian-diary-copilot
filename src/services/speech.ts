import { Platform } from "obsidian";

/**
 * Speech Recognition Service for Diary Copilot Oral Shadowing
 * Automatically activates device microphone in English mode (en-US).
 * Features auto-reconnect on mobile pauses & low-frustration error handling.
 */
export interface SpeechRecognitionHandlers {
  onStart?: () => void;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface OralMatchResult {
  spokenText: string;
  targetText: string;
  targetWords: string[];
  matchedIndices: Set<number>;
  matchRatio: number;
  isPass: boolean;
  isFailed: boolean;
}

function computeLevenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function wordSimilarity(t: string, s: string): number {
  if (!t || !s) return 0;
  if (t === s) return 1.0;

  // Common phonetic / speech recognizer variants
  if ((t === "would" && (s === "wood" || s === "we")) || 
      (t === "to" && (s === "too" || s === "two")) ||
      (t === "for" && s === "four") ||
      (t === "there" && (s === "their" || s === "theyre"))) {
    return 0.95;
  }

  // Prefix / Stem match (e.g. isn't / is, wanted / want, looks / look, using / use)
  if (t.length >= 3 && s.length >= 2) {
    if (t.startsWith(s) || s.startsWith(t)) {
      const minLen = Math.min(t.length, s.length);
      const maxLen = Math.max(t.length, s.length);
      if (minLen / maxLen >= 0.5) return 0.85;
    }
  }

  // Levenshtein fuzzy similarity for words of length >= 4
  if (t.length >= 4 && s.length >= 4) {
    const dist = computeLevenshtein(t, s);
    const maxLen = Math.max(t.length, s.length);
    const sim = 1 - dist / maxLen;
    if (sim >= 0.65) return 0.85;
  }

  return 0;
}

/**
 * Evaluates spoken transcript against target text using Word-Level Fuzzy Dynamic Programming Alignment.
 * Eliminates greedy forward pointer skipping bugs while supporting acoustic fuzzy matching.
 */
export function evaluateOralMatch(spoken: string, target: string, isFinal = false): OralMatchResult {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/n't\b/g, " not")
      .replace(/'m\b/g, " am")
      .replace(/'re\b/g, " are")
      .replace(/'ve\b/g, " have")
      .replace(/'ll\b/g, " will")
      .replace(/'d\b/g, " would")
      .replace(/'s\b/g, " is")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const rawTargetWords = target.trim().split(/\s+/).filter((w) => w.length > 0);
  const normSpoken = normalize(spoken);
  const targetTokens = rawTargetWords.map(normalizeToken);
  const spokenTokens = normSpoken.split(" ").map(normalizeToken).filter((w) => w.length > 0);

  const matchedIndices = new Set<number>();

  if (rawTargetWords.length === 0 || spokenTokens.length === 0) {
    return {
      spokenText: spoken,
      targetText: target,
      targetWords: rawTargetWords,
      matchedIndices,
      matchRatio: 0,
      isPass: false,
      isFailed: false,
    };
  }

  const M = targetTokens.length;
  const N = spokenTokens.length;

  // DP table: dp[i][j] = best alignment score of prefix T[0..i-1] with prefix S[0..j-1]
  const dp: number[][] = Array.from({ length: M + 1 }, () => new Array(N + 1).fill(0));
  // Trace table: 1 = match (1:1), 2 = match (1:2), 3 = skip target, 4 = skip spoken
  const trace: number[][] = Array.from({ length: M + 1 }, () => new Array(N + 1).fill(0));

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      let best = dp[i - 1][j]; // Option 3: skip target word
      let bestChoice = 3;

      if (dp[i][j - 1] > best) { // Option 4: skip spoken word
        best = dp[i][j - 1];
        bestChoice = 4;
      }

      // Option 1: 1-to-1 word match
      const sim = wordSimilarity(targetTokens[i - 1], spokenTokens[j - 1]);
      if (sim >= 0.70) {
        const matchScore = dp[i - 1][j - 1] + sim;
        if (matchScore > best) {
          best = matchScore;
          bestChoice = 1;
        }
      }

      // Option 2: 1-to-2 word match (e.g. "wanted" matching "want" + "it", "isn't" matching "is" + "a")
      if (j >= 2) {
        const sim12 = wordSimilarity(targetTokens[i - 1], spokenTokens[j - 2] + spokenTokens[j - 1]);
        if (sim12 >= 0.70) {
          const matchScore12 = dp[i - 1][j - 2] + sim12;
          if (matchScore12 > best) {
            best = matchScore12;
            bestChoice = 2;
          }
        }
      }

      dp[i][j] = best;
      trace[i][j] = bestChoice;
    }
  }

  // Backtrack from (M, N) to find aligned target words
  let currI = M;
  let currJ = N;
  while (currI > 0 && currJ > 0) {
    const choice = trace[currI][currJ];
    if (choice === 1) {
      matchedIndices.add(currI - 1);
      currI--;
      currJ--;
    } else if (choice === 2) {
      matchedIndices.add(currI - 1);
      currI--;
      currJ -= 2;
    } else if (choice === 3) {
      currI--;
    } else if (choice === 4) {
      currJ--;
    } else {
      currI--;
      currJ--;
    }
  }

  const matchRatio = rawTargetWords.length > 0 ? matchedIndices.size / rawTargetWords.length : 0;
  // Consider passed if >= 70% matched and user has spoken substantial length (>= 40% of target word count)
  const isPass = matchRatio >= 0.70 && spokenTokens.length >= Math.floor(rawTargetWords.length * 0.40);

  // Confirmed unable to reach 50% if:
  // 1. isFinal is true (recording ended) and matchRatio < 0.50
  // 2. OR user has already spoken substantial words (>= target length or >= 3 words) and matchRatio < 0.50
  const hasSpokenSubstantial = spokenTokens.length >= Math.max(3, Math.floor(rawTargetWords.length * 0.70));
  const isFailed = (isFinal || hasSpokenSubstantial) && matchRatio < 0.50 && spokenTokens.length > 0;

  return {
    spokenText: spoken,
    targetText: target,
    targetWords: rawTargetWords,
    matchedIndices,
    matchRatio: Math.min(1.0, matchRatio),
    isPass,
    isFailed,
  };
}

export class SpeechRecognizer {
  private recognition: any = null;
  private shouldBeListening = false;
  private currentLang = "en-US";
  private currentHandlers: SpeechRecognitionHandlers | null = null;
  private consecutiveErrors = 0;
  private silenceTimer: number | null = null;
  private maxSessionTimer: number | null = null;
  private lastTranscript = "";

  isSupported(): boolean {
    // In Obsidian Electron Desktop (Windows/Mac/Linux) and iOS (iPhone/iPad WKWebView),
    // webkitSpeechRecognition is either a non-functioning stub or strictly blocked by Apple with 'not-allowed'.
    // Returning false enables the native OS speech input workflow (iOS keyboard mic, Win+H, Fn Fn dictation).
    if (
      typeof window === "undefined" ||
      Platform.isDesktop ||
      Platform.isDesktopApp ||
      Platform.isIosApp
    ) {
      return false;
    }
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start(lang = "en-US", handlers: SpeechRecognitionHandlers, silenceTimeoutMs = 5000): boolean {
    if (!this.isSupported()) {
      return false;
    }

    this.stop();
    this.shouldBeListening = true;
    this.currentLang = lang;
    this.currentHandlers = handlers;
    this.consecutiveErrors = 0;
    this.lastTranscript = "";

    this.initAndStart(silenceTimeoutMs);
    return true;
  }

  private resetSilenceTimer(delayMs: number) {
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.silenceTimer = window.setTimeout(() => {
      // Extended silence after speaking: smoothly stop recognition
      if (this.shouldBeListening) {
        this.stop();
      }
    }, delayMs);
  }

  private initAndStart(silenceTimeoutMs: number) {
    if (!this.shouldBeListening) return;

    try {
      const SpeechClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechClass();
      this.recognition.lang = this.currentLang; // Locked to English (en-US)
      // continuous=true allows users to pause, breathe, or speak long sentences without being abruptly cut off!
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      // Max total session timeout (35 seconds) to prevent battery drain if user leaves microphone on
      this.maxSessionTimer = window.setTimeout(() => {
        if (this.shouldBeListening) {
          this.stop();
        }
      }, 35000);

      this.recognition.onstart = () => {
        this.consecutiveErrors = 0;
        this.currentHandlers?.onStart?.();
        // Initial silence timeout (give user 8s to start speaking)
        this.resetSilenceTimer(8000);
      };

      this.recognition.onresult = (event: any) => {
        let fullTranscript = "";
        let isFinal = false;
        for (let i = 0; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res && res[0]) {
            fullTranscript += res[0].transcript + " ";
            if (res.isFinal) {
              isFinal = true;
            }
          }
        }
        const trimmed = fullTranscript.trim();
        if (trimmed) {
          this.lastTranscript = trimmed;
          this.currentHandlers?.onResult?.(trimmed, isFinal);
          // User spoke: extend silence timeout by silenceTimeoutMs (e.g. 5 seconds)
          this.resetSilenceTimer(silenceTimeoutMs);
        }
      };

      this.recognition.onerror = (event: any) => {
        const errorType = event.error;
        // Ignore "no-speech" or "aborted" without stopping; keep listening
        if (errorType === "no-speech" || errorType === "aborted") {
          return;
        }

        this.consecutiveErrors++;
        this.shouldBeListening = false;
        this.stop();
        this.currentHandlers?.onError?.(errorType);
      };

      this.recognition.onend = () => {
        this.shouldBeListening = false;
        this.clearTimers();
        this.currentHandlers?.onEnd?.();
      };

      this.recognition.start();
    } catch (err) {
      console.warn("[Diary Copilot Speech] start failed:", err);
      this.shouldBeListening = false;
      this.clearTimers();
      this.currentHandlers?.onError?.(String(err));
    }
  }

  private clearTimers() {
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.maxSessionTimer) {
      window.clearTimeout(this.maxSessionTimer);
      this.maxSessionTimer = null;
    }
  }

  stop() {
    this.shouldBeListening = false;
    this.consecutiveErrors = 0;
    this.clearTimers();
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }
    this.currentHandlers?.onEnd?.();
  }

  getLastTranscript(): string {
    return this.lastTranscript;
  }

  getIsListening(): boolean {
    return this.shouldBeListening;
  }
}

export const globalSpeechRecognizer = new SpeechRecognizer();
