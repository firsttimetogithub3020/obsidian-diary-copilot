/**
 * Web Speech API Text-to-Speech (TTS) for Diary Copilot
 * Zero external dependencies, offline, zero API quota, instant playback across Desktop & Mobile.
 */
export function speakSentence(text: string) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  try {
    // Cancel previous ongoing utterance to ensure instant response on mobile & desktop
    window.speechSynthesis.cancel();

    const cleanText = text.trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "en-US";
    utterance.rate = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const enVoice =
      voices.find((v) => v.lang === "en-US" || v.lang.startsWith("en-US")) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (enVoice) {
      utterance.voice = enVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("Diary Copilot TTS error:", err);
  }
}
