/**
 * Speech Recognition Service for Diary Copilot Oral Shadowing
 * Automatically activates device microphone in English mode (en-US).
 */
export interface SpeechRecognitionHandlers {
  onStart?: () => void;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export class SpeechRecognizer {
  private recognition: any = null;
  private isListening = false;

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

    try {
      this.stop();
      const SpeechClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechClass();
      this.recognition.lang = lang; // Automatically lock to English!
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListening = true;
        handlers.onStart?.();
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
        handlers.onResult?.(fullTranscript, isFinal);
      };

      this.recognition.onerror = (event: any) => {
        this.isListening = false;
        handlers.onError?.(event.error || "語音辨識錯誤");
      };

      this.recognition.onend = () => {
        this.isListening = false;
        handlers.onEnd?.();
      };

      this.recognition.start();
      return true;
    } catch (err) {
      console.warn("SpeechRecognizer start error:", err);
      return false;
    }
  }

  stop() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }
    this.isListening = false;
  }

  getIsListening(): boolean {
    return this.isListening;
  }
}

export const globalSpeechRecognizer = new SpeechRecognizer();
