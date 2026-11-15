/**
 * High-Reliability Text-to-Speech (TTS) Service for Diary Copilot
 * 
 * Multi-layer architecture:
 * Layer 1: Native window.speechSynthesis (instant, native Android/iOS/Windows voices, zero network latency)
 * Layer 2: Online American English MP3 audio stream (high quality fallback if synthesis is unavailable)
 */

let activeAudio: HTMLAudioElement | null = null;
let lastUtterance: SpeechSynthesisUtterance | null = null;

export function speakSentence(text: string) {
  if (!text || typeof window === "undefined") return;
  const cleanText = text.trim();
  if (!cleanText) return;

  // Try Layer 1: Native Web SpeechSynthesis
  if ("speechSynthesis" in window) {
    try {
      const synth = window.speechSynthesis;

      // Cancel previous and resume if paused
      if (synth.speaking || synth.pending) {
        synth.cancel();
      }
      if (synth.paused) {
        synth.resume();
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "en-US";
      utterance.rate = 0.95; // Natural cadence for English diary learners
      utterance.pitch = 1.0;

      // Pick an English voice
      const voices = synth.getVoices();
      if (voices && voices.length > 0) {
        const enVoice =
          voices.find((v) => v.lang === "en-US" || v.lang === "en_US") ||
          voices.find((v) => v.lang.startsWith("en"));
        if (enVoice) {
          utterance.voice = enVoice;
        }
      }

      // GC retention to prevent Chromium / Android garbage collection during playback
      lastUtterance = utterance;
      (window as any)._copilotLastUtterance = utterance;

      let hasEnded = false;
      utterance.onend = () => {
        hasEnded = true;
        lastUtterance = null;
        (window as any)._copilotLastUtterance = null;
      };

      utterance.onerror = (e) => {
        console.warn("[Diary Copilot TTS] SpeechSynthesis error, trying audio fallback:", e);
        lastUtterance = null;
        (window as any)._copilotLastUtterance = null;
        if (!hasEnded) {
          playAudioStreamFallback(cleanText);
        }
      };

      synth.speak(utterance);

      // Setup onvoiceschanged listener if voices were not yet cached on startup
      if (!voices || voices.length === 0) {
        synth.onvoiceschanged = () => {
          synth.onvoiceschanged = null;
          const freshVoices = synth.getVoices();
          const enVoice =
            freshVoices.find((v) => v.lang === "en-US" || v.lang === "en_US") ||
            freshVoices.find((v) => v.lang.startsWith("en"));
          if (enVoice) {
            utterance.voice = enVoice;
          }
        };
      }
      return;
    } catch (err) {
      console.warn("[Diary Copilot TTS] SpeechSynthesis failed to start:", err);
    }
  }

  // Try Layer 2: Online American English audio stream
  playAudioStreamFallback(cleanText);
}

function playAudioStreamFallback(text: string) {
  try {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.currentTime = 0;
      activeAudio = null;
    }

    // Youdao US Pronunciation audio stream (Type 2 = American English)
    const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=2`;
    const audio = new Audio(audioUrl);
    activeAudio = audio;

    audio.onended = () => {
      activeAudio = null;
    };
    audio.onerror = (e) => {
      console.warn("[Diary Copilot TTS] Audio stream fallback failed:", e);
      activeAudio = null;
    };

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn("[Diary Copilot TTS] Audio play rejected:", err);
        activeAudio = null;
      });
    }
  } catch (err) {
    console.error("[Diary Copilot TTS] playAudioStreamFallback exception:", err);
  }
}
