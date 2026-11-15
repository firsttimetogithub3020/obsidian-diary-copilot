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
  private restartTimeout: number | null = null;
  private consecutiveErrors = 0;

  isSupported(): boolean {
    // In Obsidian Electron Desktop (Windows/Mac/Linux), webkitSpeechRecognition is a non-functioning stub
    // without Google Chrome server keys and triggers crash loops. Must return false so Desktop uses Win+H.
    if (typeof window === "undefined" || Platform.isDesktop) {
      return false;
    }
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start(lang = "en-US", handlers: SpeechRecognitionHandlers): boolean {
    if (!this.isSupported()) {
      return false;
    }

    this.stop();
    this.shouldBeListening = true;
    this.currentLang = lang;
    this.currentHandlers = handlers;
    this.consecutiveErrors = 0;

    this.initAndStart();
    return true;
  }

  private initAndStart() {
    if (!this.shouldBeListening || this.consecutiveErrors >= 3) return;

    try {
      const SpeechClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechClass();
      this.recognition.lang = this.currentLang; // Locked to English (en-US)
      this.recognition.continuous = false; // continuous=false is significantly more stable on Android & iOS WebView
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.consecutiveErrors = 0;
        this.currentHandlers?.onStart?.();
      };

      this.recognition.onresult = (event: any) => {
        let fullTranscript = "";
        let isFinal = false;
        for (let i = 0; i < event.results.length; ++i) {
          fullTranscript += event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            isFinal = true;
          }
        }
        if (fullTranscript.trim()) {
          this.currentHandlers?.onResult?.(fullTranscript, isFinal);
        }
      };

      this.recognition.onerror = (event: any) => {
        const errorType = event.error;
        // Ignore "no-speech" or "aborted" without stopping; keep listening
        if (errorType === "no-speech" || errorType === "aborted") {
          return;
        }

        this.consecutiveErrors++;

        if (this.consecutiveErrors >= 3 || errorType === "not-allowed" || errorType === "service-not-allowed") {
          this.shouldBeListening = false;
          this.stop();
          this.currentHandlers?.onError?.(errorType);
          return;
        }

        console.warn("[Diary Copilot Speech] error:", errorType);
      };

      this.recognition.onend = () => {
        // If user is still in listening mode and errors haven't accumulated, auto-restart seamlessly
        if (this.shouldBeListening && this.consecutiveErrors < 3) {
          if (this.restartTimeout) window.clearTimeout(this.restartTimeout);
          this.restartTimeout = window.setTimeout(() => {
            if (this.shouldBeListening && this.consecutiveErrors < 3) {
              this.initAndStart();
            }
          }, 250);
        } else {
          this.currentHandlers?.onEnd?.();
        }
      };

      this.recognition.start();
    } catch (err) {
      console.warn("[Diary Copilot Speech] start failed:", err);
      this.consecutiveErrors++;
      if (this.shouldBeListening && this.consecutiveErrors < 3) {
        if (this.restartTimeout) window.clearTimeout(this.restartTimeout);
        this.restartTimeout = window.setTimeout(() => {
          if (this.shouldBeListening) this.initAndStart();
        }, 500);
      }
    }
  }

  stop() {
    this.shouldBeListening = false;
    this.consecutiveErrors = 0;
    if (this.restartTimeout) {
      window.clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }
    this.currentHandlers?.onEnd?.();
  }

  getIsListening(): boolean {
    return this.shouldBeListening;
  }
}

export const globalSpeechRecognizer = new SpeechRecognizer();
