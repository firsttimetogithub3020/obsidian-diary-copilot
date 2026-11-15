import { requestUrl, Notice, Platform } from "obsidian";

/**
 * High-Reliability Text-to-Speech (TTS) Service for Diary Copilot
 * 
 * Multi-layer architecture:
 * Layer 1: High Quality Cloud Audio (Amazon Polly Salli via ttsmp3) fetched via native Obsidian requestUrl into Blob URL
 * Layer 2: Youdao American English audio stream (le=eng) fetched via requestUrl into Blob URL
 * Layer 3: Native Web SpeechSynthesis (offline fallback for systems with configured voices)
 */

let activeAudio: HTMLAudioElement | null = null;
let activeBlobUrl: string | null = null;

export async function speakSentence(text: string) {
  if (!text || typeof window === "undefined") return;
  const cleanText = text.trim();
  if (!cleanText) return;

  // Stop any currently playing audio
  stopAudio();

  // Strategy 1: High Quality Cloud Audio (Amazon Polly Salli via ttsmp3)
  try {
    const postData = `msg=${encodeURIComponent(cleanText)}&lang=Salli&source=ttsmp3`;
    const resp = await requestUrl({
      url: "https://ttsmp3.com/makemp3_new.php",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://ttsmp3.com/",
        "Origin": "https://ttsmp3.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: postData,
    });

    const data = resp.json;
    if (data && data.URL) {
      const audioResp = await requestUrl({ url: data.URL });
      if (audioResp.status === 200 && audioResp.arrayBuffer && audioResp.arrayBuffer.byteLength > 200) {
        const blob = new Blob([audioResp.arrayBuffer], { type: "audio/mpeg" });
        const blobUrl = URL.createObjectURL(blob);
        await playBlobAudio(blobUrl);
        return;
      }
    }
  } catch (err) {
    console.warn("[Diary Copilot TTS] Polly Salli via requestUrl failed:", err);
  }

  // Strategy 2: Fallback via Youdao (le=eng)
  try {
    const youdaoUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanText)}&le=eng`;
    const audioResp = await requestUrl({
      url: youdaoUrl,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });
    if (audioResp.status === 200 && audioResp.arrayBuffer && audioResp.arrayBuffer.byteLength > 500) {
      const blob = new Blob([audioResp.arrayBuffer], { type: "audio/mpeg" });
      const blobUrl = URL.createObjectURL(blob);
      await playBlobAudio(blobUrl);
      return;
    }
  } catch (err) {
    console.warn("[Diary Copilot TTS] Youdao fallback failed:", err);
  }

  // Strategy 3: Native Web SpeechSynthesis (Offline fallback)
  if ("speechSynthesis" in window) {
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) synth.cancel();
      if (synth.paused) synth.resume();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "en-US";
      utterance.rate = 0.95;
      utterance.pitch = 1.0;

      const voices = synth.getVoices();
      if (voices && voices.length > 0) {
        const enVoice =
          voices.find((v) => v.lang === "en-US" || v.lang === "en_US") ||
          voices.find((v) => v.lang.startsWith("en"));
        if (enVoice) utterance.voice = enVoice;
      }

      synth.speak(utterance);
      return;
    } catch (err) {
      console.warn("[Diary Copilot TTS] SpeechSynthesis failed:", err);
    }
  }

  new Notice("⚠️ 語音朗讀播放失敗，請檢查網路連線", 2500);
}

function stopAudio() {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {}
    activeAudio = null;
  }
  if (activeBlobUrl) {
    try {
      URL.revokeObjectURL(activeBlobUrl);
    } catch {}
    activeBlobUrl = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

function playBlobAudio(blobUrl: string): Promise<void> {
  return new Promise((resolve) => {
    activeBlobUrl = blobUrl;
    const audio = new Audio(blobUrl);
    activeAudio = audio;

    audio.onended = () => {
      stopAudio();
      resolve();
    };

    audio.onerror = (e) => {
      console.warn("[Diary Copilot TTS] Blob Audio playback error:", e);
      stopAudio();
      resolve();
    };

    audio.play().catch((err) => {
      console.warn("[Diary Copilot TTS] Play promise rejected:", err);
      stopAudio();
      resolve();
    });
  });
}
