import { App, Modal, Notice, TFile } from "obsidian";
import type DiaryCopilotPlugin from "../main";
import { speakSentence, stopAudio, splitTextIntoSentences, isAudioPlaying, unlockAudio } from "../services/tts";
import { tidyUpTodayDiary } from "../commands/tidyUp";
import { setupPinchZoom, PinchZoomController } from "./pinchZoom";

export interface ShadowingSection {
  title: string;
  sentences: string[];
}

/**
 * Parses full note text into distinct sections separated by markdown # headings
 */
export function parseShadowingSections(fullText: string): ShadowingSection[] {
  if (!fullText) return [];
  // Strip YAML frontmatter if present
  const clean = fullText.replace(/^---[\s\S]*?\n---\s*/, "").trim();
  const lines = clean.split("\n");
  const rawSections: { title: string; lines: string[] }[] = [];
  let currentTitle = "導言";
  let currentLines: string[] = [];

  for (const line of lines) {
    // Matches markdown headings (#, ##, ###)
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) {
      if (currentLines.length > 0) {
        rawSections.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = match[1].replace(/[*_#]/g, "").trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    rawSections.push({ title: currentTitle, lines: currentLines });
  }

  // Filter sections that have actual sentences
  const sections: ShadowingSection[] = [];
  for (const raw of rawSections) {
    const text = raw.lines.join("\n").trim();
    const sentences = splitTextIntoSentences(text);
    if (sentences.length > 0) {
      sections.push({
        title: raw.title,
        sentences,
      });
    }
  }

  return sections;
}

export class FullTextShadowingModal extends Modal {
  private plugin: DiaryCopilotPlugin;
  private fullText: string;
  private file: TFile;
  private allSentences: string[] = [];
  private sections: ShadowingSection[] = [];
  private activeSectionIdx = 0; // 0 = 全部, 1..N = sections[0..N-1]
  private sectionTabEls: HTMLElement[] = [];
  private teleprompterEl: HTMLElement | null = null;
  private sentences: string[] = [];
  private currentSentenceIdx = 0;
  private isPlaying = false;
  private playbackRate = 1.0;
  private sentenceElements: HTMLElement[] = [];
  private playBtn: HTMLButtonElement | null = null;
  private statusTextEl: HTMLElement | null = null;
  private progressBarEl: HTMLElement | null = null;
  private pinchZoomCtrl: PinchZoomController | null = null;
  private playSessionId = 0;

  constructor(app: App, plugin: DiaryCopilotPlugin, fullText: string, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.fullText = fullText;
    this.file = file;
    this.allSentences = splitTextIntoSentences(fullText);
    this.sections = parseShadowingSections(fullText);
    this.sentences = this.allSentences;
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

    // 1.5 Section Tabs (Shown when 2 or more distinct # heading sections exist)
    if (this.sections.length >= 2) {
      const sectionsBar = contentEl.createDiv({ cls: "diary-copilot-shadowing-sections-bar" });
      this.sectionTabEls = [];

      // Tab 0: 全部
      const allTab = sectionsBar.createEl("button", {
        cls: "diary-copilot-shadowing-section-pill is-active",
        text: `📖 全部 (${this.allSentences.length}句)`,
      });
      allTab.addEventListener("click", () => {
        unlockAudio();
        this.switchSection(0);
      });
      this.sectionTabEls.push(allTab);

      // Tabs 1..N: Individual # headings
      this.sections.forEach((sec, idx) => {
        const tab = sectionsBar.createEl("button", {
          cls: "diary-copilot-shadowing-section-pill",
          text: `# ${sec.title} (${sec.sentences.length}句)`,
        });
        tab.addEventListener("click", () => {
          unlockAudio();
          this.switchSection(idx + 1);
        });
        this.sectionTabEls.push(tab);
      });
    }

    // 2. Teleprompter Lyrics View
    this.teleprompterEl = contentEl.createDiv({ cls: "diary-copilot-shadowing-teleprompter" });
    this.renderTeleprompter();

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
      unlockAudio();
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
      unlockAudio();
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
      text: "✅ 結束跟讀",
    });
    doneBtn.addEventListener("click", () => {
      this.close();
    });
  }

  private renderTeleprompter() {
    if (!this.teleprompterEl) return;
    this.teleprompterEl.empty();
    this.sentenceElements = [];

    if (this.sentences.length === 0) {
      this.teleprompterEl.createDiv({ cls: "diary-copilot-shadowing-empty", text: "未偵測到英文日記句子。" });
    } else {
      this.sentences.forEach((sentence, idx) => {
        const itemEl = this.teleprompterEl!.createDiv({
          cls: `diary-copilot-shadowing-sentence ${idx === 0 ? "is-upcoming" : ""}`,
        });
        itemEl.createSpan({ cls: "sentence-num", text: `${idx + 1}.` });
        itemEl.createDiv({ cls: "sentence-text", text: sentence });
        itemEl.addEventListener("click", () => {
          unlockAudio();
          this.currentSentenceIdx = idx;
          this.highlightCurrentSentence();
          if (this.isPlaying) {
            this.playNextSentence();
          }
        });
        this.sentenceElements.push(itemEl);
      });
    }

    this.highlightCurrentSentence();
  }

  private switchSection(sectionIdx: number) {
    if (this.activeSectionIdx === sectionIdx) return;
    this.activeSectionIdx = sectionIdx;

    // Invalidate active playback session & stop audio
    this.isPlaying = false;
    this.playSessionId++;
    stopAudio();

    if (sectionIdx === 0) {
      this.sentences = this.allSentences;
    } else {
      this.sentences = this.sections[sectionIdx - 1].sentences;
    }
    this.currentSentenceIdx = 0;

    // Update active visual state on section tabs
    this.sectionTabEls.forEach((tab, i) => {
      if (i === sectionIdx) tab.addClass("is-active");
      else tab.removeClass("is-active");
    });

    // Re-render teleprompter list for the newly selected section
    this.renderTeleprompter();

    // Reset controls
    if (this.playBtn) {
      this.playBtn.setText("▶️ 開始朗讀跟讀");
      this.playBtn.removeClass("is-playing");
    }
    if (this.statusTextEl) {
      const sectionName = sectionIdx === 0 ? "全部日記" : `「${this.sections[sectionIdx - 1].title}」`;
      this.statusTextEl.setText(`🎧 已切換至 ${sectionName}，點擊「▶️ 開始朗讀跟讀」開始`);
    }
    if (this.progressBarEl) {
      this.progressBarEl.style.width = "0%";
    }
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
    this.playSessionId++;
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
    const currentSession = ++this.playSessionId;

    if (this.currentSentenceIdx >= this.sentences.length) {
      // Completed all sentences in the active section!
      this.onFullTextCompleted();
      return;
    }

    this.highlightCurrentSentence();
    const sentenceText = this.sentences[this.currentSentenceIdx];

    speakSentence(
      sentenceText,
      () => {
        if (!this.isPlaying || this.playSessionId !== currentSession) return;
        this.currentSentenceIdx++;
        // Small 250ms natural breathing pause between sentences
        window.setTimeout(() => {
          if (!this.isPlaying || this.playSessionId !== currentSession) return;
          this.playNextSentence();
        }, 250);
      },
      this.playbackRate,
      (err) => {
        if (!this.isPlaying || this.playSessionId !== currentSession) return;
        this.pause();
        new Notice("⚠️ 語音朗讀播放失敗，請檢查網路連線", 3000);
      }
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

  private onFullTextCompleted() {
    this.isPlaying = false;
    if (this.playBtn) {
      this.playBtn.setText("🔄 再次跟讀");
      this.playBtn.removeClass("is-playing");
    }
    const sectionName = this.activeSectionIdx === 0 ? "今日全篇" : `「${this.sections[this.activeSectionIdx - 1]?.title || ""}」`;
    if (this.statusTextEl) {
      this.statusTextEl.setText(`🎉 恭喜！${sectionName} 影子跟讀完成！已為大腦建立道地語流記憶！`);
    }
    new Notice(`🎉 恭喜！${sectionName} 影子跟讀完成！`, 3500);
  }

  onClose() {
    this.isPlaying = false;
    this.playSessionId++;
    stopAudio();
    if (this.pinchZoomCtrl) {
      this.pinchZoomCtrl.cleanup();
      this.pinchZoomCtrl = null;
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}
