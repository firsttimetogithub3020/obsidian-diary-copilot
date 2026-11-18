import { App, Modal, Notice, TFile } from "obsidian";
import type DiaryCopilotPlugin from "../main";
import { speakSentence, stopAudio, splitTextIntoSentences, isAudioPlaying } from "../services/tts";
import { tidyUpTodayDiary } from "../commands/tidyUp";
import { setupPinchZoom, PinchZoomController } from "./pinchZoom";

export class FullTextShadowingModal extends Modal {
  private plugin: DiaryCopilotPlugin;
  private fullText: string;
  private file: TFile;
  private sentences: string[] = [];
  private currentSentenceIdx = 0;
  private isPlaying = false;
  private playbackRate = 1.0;
  private sentenceElements: HTMLElement[] = [];
  private playBtn: HTMLButtonElement | null = null;
  private statusTextEl: HTMLElement | null = null;
  private progressBarEl: HTMLElement | null = null;
  private pinchZoomCtrl: PinchZoomController | null = null;

  constructor(app: App, plugin: DiaryCopilotPlugin, fullText: string, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.fullText = fullText;
    this.file = file;
    this.sentences = splitTextIntoSentences(fullText);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("diary-copilot-shadowing-modal");
    this.modalEl.addClass("diary-copilot-shadowing-modal-window");

    // Initialize Pinch-to-Zoom gesture on mobile / Ctrl+Wheel on desktop
    const initialFontSize = this.plugin.settings.shadowingFontSize || 15.5;
    this.pinchZoomCtrl = setupPinchZoom({
      containerEl: contentEl,
      initialSize: initialFontSize,
      minSize: 12,
      maxSize: 32,
      cssVariable: "--shadowing-sentence-font-size",
      onSizeChange: async (newSize) => {
        this.plugin.settings.shadowingFontSize = newSize;
        await this.plugin.saveSettings();
      },
    });

    // 1. Header Bar
    const header = contentEl.createDiv({ cls: "diary-copilot-shadowing-header" });
    header.createEl("h3", { text: "🎧 全篇沉浸影子跟讀 (Full-Text Shadowing)" });

    // Speed Controls
    const speedGroup = header.createDiv({ cls: "diary-copilot-shadowing-speed-group" });
    speedGroup.createSpan({ cls: "speed-label", text: "語速：" });
    [0.8, 1.0, 1.2].forEach((rate) => {
      const btn = speedGroup.createEl("button", {
        cls: `speed-btn ${this.playbackRate === rate ? "is-active" : ""}`,
        text: `${rate}x`,
      });
      btn.addEventListener("click", () => {
        this.playbackRate = rate;
        speedGroup.querySelectorAll(".speed-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
      });
    });

    // 2. Teleprompter Lyrics View
    const teleprompter = contentEl.createDiv({ cls: "diary-copilot-shadowing-teleprompter" });
    this.sentenceElements = [];

    if (this.sentences.length === 0) {
      teleprompter.createDiv({ cls: "diary-copilot-shadowing-empty", text: "未偵測到英文日記句子。" });
    } else {
      this.sentences.forEach((sentence, idx) => {
        const itemEl = teleprompter.createDiv({
          cls: `diary-copilot-shadowing-sentence ${idx === 0 ? "is-upcoming" : ""}`,
        });
        itemEl.createSpan({ cls: "sentence-num", text: `${idx + 1}.` });
        itemEl.createDiv({ cls: "sentence-text", text: sentence });
        itemEl.addEventListener("click", () => {
          this.currentSentenceIdx = idx;
          this.highlightCurrentSentence();
          if (this.isPlaying) {
            this.playNextSentence();
          }
        });
        this.sentenceElements.push(itemEl);
      });
    }

    // 3. Bottom Controls Dock (Fixed at bottom of modal, never overlaps sentences)
    const dockEl = contentEl.createDiv({ cls: "diary-copilot-shadowing-dock" });

    // Progress bar
    const progressWrapper = dockEl.createDiv({ cls: "diary-copilot-shadowing-progress-wrapper" });
    this.progressBarEl = progressWrapper.createDiv({ cls: "diary-copilot-shadowing-progress-bar" });

    // Status Text
    this.statusTextEl = dockEl.createDiv({
      cls: "diary-copilot-shadowing-status",
      text: "🎧 建議戴上耳機，落後半拍同步開口複誦 (Shadowing)",
    });

    // Action Controls Bar
    const controlBar = dockEl.createDiv({ cls: "diary-copilot-shadowing-controls" });

    this.playBtn = controlBar.createEl("button", {
      cls: "diary-copilot-shadowing-play-btn",
      text: "▶️ 開始朗讀跟讀",
    });
    this.playBtn.addEventListener("click", () => {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });

    const secGroup = controlBar.createDiv({ cls: "diary-copilot-shadowing-sec-group" });

    const restartBtn = secGroup.createEl("button", {
      cls: "diary-copilot-shadowing-sub-btn",
      text: "🔄 從頭播放",
    });
    restartBtn.addEventListener("click", () => {
      this.currentSentenceIdx = 0;
      this.play();
    });

    const reTidyBtn = secGroup.createEl("button", {
      cls: "diary-copilot-shadowing-sub-btn",
      text: "✨ 重新整理",
      attr: { title: "重新呼叫 AI 整理今日日記並更新跟讀內容" },
    });
    reTidyBtn.addEventListener("click", async () => {
      this.close();
      await tidyUpTodayDiary(this.app, this.plugin);
    });

    const doneBtn = secGroup.createEl("button", {
      cls: "diary-copilot-shadowing-sub-btn diary-copilot-shadowing-done-btn",
      text: "✅ 完成跟讀並紀錄",
    });
    doneBtn.addEventListener("click", async () => {
      await this.recordShadowingCompleted();
      this.close();
    });

    // Auto-highlight first sentence
    this.highlightCurrentSentence();
  }

  private play() {
    if (this.sentences.length === 0) return;
    this.isPlaying = true;
    if (this.playBtn) {
      this.playBtn.setText("⏸️ 暫停");
      this.playBtn.addClass("is-playing");
    }
    if (this.statusTextEl) {
      this.statusTextEl.setText("🎙️ 正在連貫朗讀，請落後半拍同步跟讀...");
    }
    this.playNextSentence();
  }

  private pause() {
    this.isPlaying = false;
    stopAudio();
    if (this.playBtn) {
      this.playBtn.setText("▶️ 繼續跟讀");
      this.playBtn.removeClass("is-playing");
    }
    if (this.statusTextEl) {
      this.statusTextEl.setText("⏸️ 已暫停");
    }
  }

  private playNextSentence() {
    if (!this.isPlaying) return;
    if (this.currentSentenceIdx >= this.sentences.length) {
      // Completed all sentences!
      this.onFullTextCompleted();
      return;
    }

    this.highlightCurrentSentence();
    const sentenceText = this.sentences[this.currentSentenceIdx];

    speakSentence(
      sentenceText,
      () => {
        if (!this.isPlaying) return;
        this.currentSentenceIdx++;
        // Small 250ms natural breathing pause between sentences
        window.setTimeout(() => {
          this.playNextSentence();
        }, 250);
      },
      this.playbackRate
    );
  }

  private highlightCurrentSentence() {
    this.sentenceElements.forEach((el, idx) => {
      if (idx === this.currentSentenceIdx) {
        el.className = "diary-copilot-shadowing-sentence is-active";
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {}
      } else if (idx < this.currentSentenceIdx) {
        el.className = "diary-copilot-shadowing-sentence is-passed";
      } else {
        el.className = "diary-copilot-shadowing-sentence";
      }
    });

    if (this.progressBarEl && this.sentences.length > 0) {
      const pct = Math.min(100, Math.round(((this.currentSentenceIdx + 1) / this.sentences.length) * 100));
      this.progressBarEl.style.width = `${pct}%`;
    }
  }

  private async onFullTextCompleted() {
    this.isPlaying = false;
    if (this.playBtn) {
      this.playBtn.setText("🔄 再次跟讀");
      this.playBtn.removeClass("is-playing");
    }
    if (this.statusTextEl) {
      this.statusTextEl.setText("🎉 恭喜！今日全篇影子跟讀完成！已為大腦建立道地語流記憶！");
    }
    await this.recordShadowingCompleted();
    new Notice("🎉 今日全篇影子跟讀完成！已自動將口說成就標註於筆記中", 3500);
  }

  private async recordShadowingCompleted() {
    try {
      const content = await this.app.vault.read(this.file);
      const pad = (n: number) => String(n).padStart(2, "0");
      const d = new Date();
      const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

      let updated = content;
      if (/^---\n[\s\S]*?\n---/.test(content)) {
        if (/oral_shadowed:\s*true/i.test(content)) {
          // Already marked, update time
          updated = content.replace(/shadowed_at:\s*["']?.*?["']?/i, `shadowed_at: "${timeStr}"`);
        } else {
          // Insert into frontmatter
          updated = content.replace(/^---\n/, `---\noral_shadowed: true\nshadowed_at: "${timeStr}"\n`);
        }
      } else {
        // Prepend frontmatter
        updated = `---\noral_shadowed: true\nshadowed_at: "${timeStr}"\n---\n\n${content}`;
      }

      if (updated !== content) {
        await this.app.vault.modify(this.file, updated);
      }
    } catch (e) {
      console.warn("[Diary Copilot] Failed to record shadowing completion:", e);
    }
  }

  onClose() {
    this.isPlaying = false;
    stopAudio();
    if (this.pinchZoomCtrl) {
      this.pinchZoomCtrl.cleanup();
      this.pinchZoomCtrl = null;
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}
