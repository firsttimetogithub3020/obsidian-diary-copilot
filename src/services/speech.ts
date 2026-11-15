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
}

/**
 * Evaluates spoken transcript against target text, providing word-level match details
 * and a forgiving threshold (>= 70%) for low-frustration English oral practice.
 */
export function evaluateOralMatch(spoken: string, target: string): OralMatchResult {
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

  return {
    spokenText: spoken,
    targetText: target,
    targetWords: rawTargetWords,
    matchedIndices,
    matchRatio: Math.min(1.0, matchRatio),
    isPass,
  };
}

export class SpeechRecognizer {
  private recognition: any = null;
  private shouldBeListening = false;
  private currentLang = "en-US";
  private currentHandlers: SpeechRecognitionHandlers | null = null;
  private restartTimeout: number | null = null;

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }

  start(lang = "en-US", handlers: SpeechRecognitionHandlers): boolean {
    if (!this.isSupported()) {
      return false;
    }

    this.stop();
    this.shouldBeListening = true;
    this.currentLang = lang;
    this.currentHandlers = handlers;

    this.initAndStart();
    return true;
  }

  private initAndStart() {
    if (!this.shouldBeListening) return;

    try {
      const SpeechClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechClass();
      this.recognition.lang = this.currentLang; // Locked to English (en-US)
      this.recognition.continuous = false; // continuous=false is significantly more stable on Android & iOS WebView
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
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

        if (errorType === "not-allowed" || errorType === "service-not-allowed") {
          this.shouldBeListening = false;
          this.currentHandlers?.onError?.("not-allowed");
          return;
        }

        console.warn("Speech recognition error:", errorType);
      };

      this.recognition.onend = () => {
        // If user is still in listening mode, auto-restart seamlessly so microphone doesn't prematurely drop!
        if (this.shouldBeListening) {
          if (this.restartTimeout) window.clearTimeout(this.restartTimeout);
          this.restartTimeout = window.setTimeout(() => {
            if (this.shouldBeListening) {
              this.initAndStart();
            }
          }, 80);
        } else {
          this.currentHandlers?.onEnd?.();
        }
      };

      this.recognition.start();
    } catch (err) {
      console.warn("Speech recognition start failed:", err);
      if (this.shouldBeListening) {
        if (this.restartTimeout) window.clearTimeout(this.restartTimeout);
        this.restartTimeout = window.setTimeout(() => {
          if (this.shouldBeListening) this.initAndStart();
        }, 200);
      }
    }
  }

  stop() {
    this.shouldBeListening = false;
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
