import { requestUrl, Notice, Platform } from "obsidian";

/**
 * High-Reliability Cross-Platform Text-to-Speech (TTS) Service for Diary Copilot
 * 
 * Multi-layer architecture:
 * Layer 1: Google Translate American English TTS (gtx client) via Web Audio API (AudioContext)
 *          with native PCM buffer concatenation for seamless, zero-latency playback on iOS/Desktop
 * Layer 2: Google Translate TTS secondary endpoint (tw-ob client)
 * Layer 3: Amazon Polly Salli via ttsmp3
 * Layer 4: HTMLAudioElement fallback (reusing unlocked shared audio element)
 * Layer 5: Native Web SpeechSynthesis (offline fallback)
 */

let audioContext: AudioContext | null = null;
let activeSourceNode: AudioBufferSourceNode | null = null;
let sharedAudio: HTMLAudioElement | null = null;
let activeBlobUrl: string | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtxClass) {
      audioContext = new AudioCtxClass();
    }
  }
  return audioContext;
}

/**
 * Proactively unlocks AudioContext and HTMLAudioElement during user click/touch gestures.
 * Critical for iOS Safari and Obsidian WKWebView autoplay policies!
 */
export function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  if (!sharedAudio && typeof window !== "undefined") {
    try {
      sharedAudio = new Audio();
      (sharedAudio as any).playsInline = true;
      (sharedAudio as any).webkitPlaysinline = true;
      sharedAudio.setAttribute("playsinline", "true");
      sharedAudio.setAttribute("webkit-playsinline", "true");
    } catch {}
  }
}

export function isAudioPlaying(): boolean {
  if (activeSourceNode) return true;
  if (sharedAudio && !sharedAudio.paused && !sharedAudio.ended) return true;
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

function decodeAudioDataSafe(ctx: AudioContext, buffer: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const res = ctx.decodeAudioData(
      buffer,
      (decoded) => resolve(decoded),
      (err) => reject(err)
    );
    if (res && typeof (res as any).then === "function") {
      (res as Promise<AudioBuffer>).then(resolve).catch(reject);
    }
  });
}

function concatenateAudioBuffers(ctx: AudioContext, buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 1) return buffers[0];
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  const numberOfChannels = buffers[0].numberOfChannels;
  const sampleRate = buffers[0].sampleRate;
  const out = ctx.createBuffer(numberOfChannels, totalLength, sampleRate);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = out.getChannelData(ch);
    let offset = 0;
    for (const b of buffers) {
      channelData.set(b.getChannelData(ch), offset);
      offset += b.length;
    }
  }
  return out;
}

async function playWithAudioContext(buffers: ArrayBuffer[], rate = 1.0, onEnd?: () => void): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) throw new Error("AudioContext not supported");
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  stopAudio();

  const decodedBuffers: AudioBuffer[] = [];
  for (const buf of buffers) {
    const decoded = await decodeAudioDataSafe(ctx, buf.slice(0));
    decodedBuffers.push(decoded);
  }

  const combinedBuffer = concatenateAudioBuffers(ctx, decodedBuffers);
  const source = ctx.createBufferSource();
  source.buffer = combinedBuffer;
  try {
    source.playbackRate.value = rate;
  } catch {}
  source.connect(ctx.destination);
  activeSourceNode = source;

  return new Promise((resolve) => {
    source.onended = () => {
      activeSourceNode = null;
      onEnd?.();
      resolve();
    };
    source.start(0);
  });
}

async function playAudioBuffers(buffers: ArrayBuffer[], rate = 1.0, onEnd?: () => void): Promise<void> {
  // Strategy A: Web Audio API (Primary for iOS & Desktop, zero blob/autoplay issues)
  try {
    await playWithAudioContext(buffers, rate, onEnd);
    return;
  } catch (ctxErr) {
    console.warn("[Diary Copilot TTS] Web Audio Context failed, trying HTMLAudio fallback:", ctxErr);
  }

  // Strategy B: HTML Audio Element with concatenated Blob
  const combinedBlob = new Blob(buffers, { type: "audio/mpeg" });
  const blobUrl = URL.createObjectURL(combinedBlob);
  await playBlobAudio(blobUrl, rate, onEnd);
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

  // Ensure audio is unlocked
  unlockAudio();

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
    await playAudioBuffers(audioBuffers, rate, onEnd);
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
    await playAudioBuffers(audioBuffers, rate, onEnd);
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
        await playAudioBuffers([audioResp.arrayBuffer], rate, onEnd);
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
  if (activeSourceNode) {
    try {
      activeSourceNode.onended = null;
      activeSourceNode.stop();
      activeSourceNode.disconnect();
    } catch {}
    activeSourceNode = null;
  }
  if (sharedAudio) {
    try {
      sharedAudio.onended = null;
      sharedAudio.onerror = null;
      sharedAudio.pause();
      sharedAudio.currentTime = 0;
    } catch {}
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
    if (!sharedAudio) {
      sharedAudio = new Audio();
      (sharedAudio as any).playsInline = true;
      (sharedAudio as any).webkitPlaysinline = true;
      sharedAudio.setAttribute("playsinline", "true");
      sharedAudio.setAttribute("webkit-playsinline", "true");
    }
    const audio = sharedAudio;
    try {
      audio.playbackRate = rate;
    } catch {}

    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
    };

    audio.onended = () => {
      cleanup();
      stopAudio();
      onEnd?.();
      resolve();
    };

    audio.onerror = (e) => {
      cleanup();
      console.warn("[Diary Copilot TTS] Blob Audio playback error:", e);
      stopAudio();
      reject(e);
    };

    audio.src = blobUrl;
    audio.load();
    audio.play().catch((err) => {
      cleanup();
      console.warn("[Diary Copilot TTS] Play promise rejected:", err);
      stopAudio();
      reject(err);
    });
  });
}
