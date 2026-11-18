import { requestUrl, Notice, Platform } from "obsidian";

/**
 * High-Reliability Text-to-Speech (TTS) Service for Diary Copilot
 * 
 * Multi-layer architecture:
 * Layer 1: Google Translate American English TTS (gtx client) with seamless MP3 frame concatenation for long sentences
 * Layer 2: Google Translate TTS secondary endpoint (tw-ob client)
 * Layer 3: Amazon Polly Salli via ttsmp3
 * Layer 4: Native Web SpeechSynthesis (offline fallback)
 */

let activeAudio: HTMLAudioElement | null = null;
let activeBlobUrl: string | null = null;

export function isAudioPlaying(): boolean {
  if (activeAudio && !activeAudio.paused && !activeAudio.ended) return true;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return window.speechSynthesis.speaking;
  }
  return false;
}

export function splitTextIntoSentences(text: string): string[] {
  if (!text) return [];
  // Clean markdown headers / bullets
  const clean = text
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\[\[(.*?)\]\]/g, "$1")
    .trim();

  // Match sentences ending in punctuation
  const rawSentences = clean.match(/[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+$/g) || [clean];
  return rawSentences
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /[a-zA-Z]/.test(s));
}

/**
 * Splits sentences longer than maxLen (default 160 chars) into natural clause chunks
 * (e.g. by punctuation [,;:—–-] or spaces) for Google Translate TTS API.
 */
function chunkTextForTTS(text: string, maxLen = 160): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  const parts = text.split(/([,;:—–\-]|\s+)/);
  let cur = "";

  for (const p of parts) {
    if ((cur + p).length <= maxLen) {
      cur += p;
    } else {
      if (cur.trim()) chunks.push(cur.trim());
      cur = p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

async function fetchGoogleTTSBuffer(text: string, client = "gtx"): Promise<ArrayBuffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=${client}&q=${encodeURIComponent(text)}`;
  const resp = await requestUrl({
    url,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (resp.status === 200 && resp.arrayBuffer && resp.arrayBuffer.byteLength > 200) {
    return resp.arrayBuffer;
  }
  throw new Error(`Google TTS status ${resp.status}`);
}

export async function speakSentence(
  text: string,
  onEnd?: () => void,
  rate = 1.0,
  onError?: (err?: any) => void
) {
  if (!text || typeof window === "undefined") return;
  const cleanText = text.trim();
  if (!cleanText) return;

  // Stop any currently playing audio
  stopAudio();

  // Strategy 1: Google Translate TTS (client=gtx) with seamless chunk concatenation
  try {
    const chunks = chunkTextForTTS(cleanText, 160);
    const audioBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const buf = await fetchGoogleTTSBuffer(chunk, "gtx");
      audioBuffers.push(buf);
    }
    const combinedBlob = new Blob(audioBuffers, { type: "audio/mpeg" });
    const blobUrl = URL.createObjectURL(combinedBlob);
    await playBlobAudio(blobUrl, rate, onEnd);
    return;
  } catch (err) {
    console.warn("[Diary Copilot TTS] Google TTS gtx failed, trying tw-ob fallback:", err);
  }

  // Strategy 2: Google Translate TTS secondary endpoint (client=tw-ob)
  try {
    const chunks = chunkTextForTTS(cleanText, 160);
    const audioBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const buf = await fetchGoogleTTSBuffer(chunk, "tw-ob");
      audioBuffers.push(buf);
    }
    const combinedBlob = new Blob(audioBuffers, { type: "audio/mpeg" });
    const blobUrl = URL.createObjectURL(combinedBlob);
    await playBlobAudio(blobUrl, rate, onEnd);
    return;
  } catch (err) {
    console.warn("[Diary Copilot TTS] Google TTS tw-ob failed, trying Polly fallback:", err);
  }

  // Strategy 3: Amazon Polly Salli via ttsmp3
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
        await playBlobAudio(blobUrl, rate, onEnd);
        return;
      }
    }
  } catch (err) {
    console.warn("[Diary Copilot TTS] Polly Salli via requestUrl failed:", err);
  }

  // Strategy 4: Native Web SpeechSynthesis (Offline fallback)
  if ("speechSynthesis" in window) {
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) synth.cancel();
      if (synth.paused) synth.resume();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "en-US";
      utterance.rate = 0.95 * rate;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        onEnd?.();
      };
      utterance.onerror = (e) => {
        console.warn("[Diary Copilot TTS] SpeechSynthesis error:", e);
        if (onError) onError(e);
        else {
          new Notice("⚠️ 語音朗讀播放失敗，請檢查網路連線", 2500);
          onEnd?.();
        }
      };

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

  if (onError) {
    onError(new Error("All TTS strategies failed"));
  } else {
    new Notice("⚠️ 語音朗讀播放失敗，請檢查網路連線", 2500);
  }
}

export function stopAudio() {
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

function playBlobAudio(blobUrl: string, rate = 1.0, onEnd?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    activeBlobUrl = blobUrl;
    const audio = new Audio(blobUrl);
    activeAudio = audio;
    try {
      audio.playbackRate = rate;
    } catch {}

    audio.onended = () => {
      stopAudio();
      onEnd?.();
      resolve();
    };

    audio.onerror = (e) => {
      console.warn("[Diary Copilot TTS] Blob Audio playback error:", e);
      stopAudio();
      reject(e);
    };

    audio.play().catch((err) => {
      console.warn("[Diary Copilot TTS] Play promise rejected:", err);
      stopAudio();
      reject(err);
    });
  });
}
