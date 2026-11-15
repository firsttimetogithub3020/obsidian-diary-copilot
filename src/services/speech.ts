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

/**
 * Evaluates spoken transcript against target text, providing word-level match details,
 * a forgiving threshold (>= 70%) for passing, and detects when recognition fails to reach 50%.
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
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const rawTargetWords = target.trim().split(/\s+/).filter((w) => w.length > 0);
  const normSpoken = normalize(spoken);
  const normSpokenWords = normSpoken.split(" ").filter((w) => w.length > 0);
  const matchedIndices = new Set<number>();

  if (rawTargetWords.length === 0 || normSpokenWords.length === 0) {
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

  let searchStart = 0;
  for (let i = 0; i < rawTargetWords.length; i++) {
    const cleanWord = normalize(rawTargetWords[i]);
    if (!cleanWord) continue;

    const idx = normSpokenWords.indexOf(cleanWord, searchStart);
    if (idx !== -1) {
      matchedIndices.add(i);
      searchStart = idx + 1;
    }
  }

  const matchRatio = rawTargetWords.length > 0 ? matchedIndices.size / rawTargetWords.length : 0;
  // Consider passed if >= 70% matched and spoken length is at least 45% of word count
  const isPass = matchRatio >= 0.70 && normSpokenWords.length >= Math.floor(rawTargetWords.length * 0.45);

  // Confirmed unable to reach 50% if:
  // 1. isFinal is true (sentence segment ended by recognizer) and matchRatio < 0.50
  // 2. OR user has already spoken substantial words (>= target length or >= 3 words) and matchRatio < 0.50
  const hasSpokenSubstantial = normSpokenWords.length >= Math.max(3, Math.floor(rawTargetWords.length * 0.75));
  const isFailed = (isFinal || hasSpokenSubstantial) && matchRatio < 0.50 && normSpokenWords.length > 0;

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
    // In Obsidian Electron Desktop (Windows/Mac/Linux), webkitSpeechRecognition is a non-functioning stub
    // without Google Chrome server keys and triggers crash loops. Must return false so Desktop uses Win+H.
    if (typeof window === "undefined" || Platform.isDesktop || Platform.isDesktopApp) {
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
