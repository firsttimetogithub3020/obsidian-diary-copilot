/**
 * High-reliability Text-to-Speech (TTS) for Diary Copilot
 * 1. Primary: Crystal-clear Google Translate human voice audio stream (instant, authentic pronunciation)
 * 2. Fallback: Browser Web Speech API with Chromium/Electron GC protection & auto-resume
 */

let activeAudio: HTMLAudioElement | null = null;
let lastUtterance: SpeechSynthesisUtterance | null = null;

export function speakSentence(text: string) {
  if (!text || typeof window === "undefined") return;
  const cleanText = text.trim();
  if (!cleanText) return;

  // 1. Primary: High quality Google TTS audio stream
  try {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(cleanText)}`;
    const audio = new Audio(ttsUrl);
    activeAudio = audio;

    audio.onended = () => {
      activeAudio = null;
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          // Playing successfully!
        })
        .catch(() => {
          playWebSpeechFallback(cleanText);
        });
      return;
    }
  } catch {
    // Fall back to Web Speech API
  }

  playWebSpeechFallback(cleanText);
}

function playWebSpeechFallback(text: string) {
  if (!("speechSynthesis" in window)) return;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const enVoice =
      voices.find((v) => v.lang === "en-US" || v.lang.startsWith("en-US")) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (enVoice) {
      utterance.voice = enVoice;
    }

    // Retain global reference to avoid Chromium GC bug
    lastUtterance = utterance;
    (window as any)._copilotLastUtterance = utterance;

    utterance.onend = () => {
      lastUtterance = null;
      (window as any)._copilotLastUtterance = null;
    };
    utterance.onerror = () => {
      lastUtterance = null;
      (window as any)._copilotLastUtterance = null;
    };

    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 20);
  } catch (err) {
    console.warn("TTS fallback error:", err);
  }
}
