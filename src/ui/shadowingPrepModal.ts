import { App, Modal, TFile } from "obsidian";
import type DiaryCopilotPlugin from "../main";
import { tidyUpTodayDiary } from "../commands/tidyUp";
import { FullTextShadowingModal } from "./fullTextShadowingModal";
import { setupPinchZoom, PinchZoomController } from "./pinchZoom";

export class ShadowingPrepModal extends Modal {
  private plugin: DiaryCopilotPlugin;
  private rawDraftText: string;
  private file: TFile;
  private existingEnglish: string | null;
  private pinchZoomCtrl: PinchZoomController | null = null;

  constructor(app: App, plugin: DiaryCopilotPlugin, rawDraftText: string, file: TFile, existingEnglish: string | null = null) {
    super(app);
    this.plugin = plugin;
    this.rawDraftText = rawDraftText;
    this.file = file;
    this.existingEnglish = existingEnglish;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("diary-copilot-shadowing-prep-modal");

    // Initialize Pinch-to-Zoom gesture on mobile / Ctrl+Wheel on desktop
    const initialFontSize = this.plugin.settings.shadowingFontSize || 15.5;
    this.pinchZoomCtrl = setupPinchZoom({
      containerEl: contentEl,
      initialSize: initialFontSize,
      minSize: 12,
      maxSize: 28,
      cssVariable: "--shadowing-prep-font-size",
      onSizeChange: async (newSize) => {
        this.plugin.settings.shadowingFontSize = newSize;
        await this.plugin.saveSettings();
      },
    });

    contentEl.createEl("h3", { text: "✨ 整理今日日記與跟讀準備" });

    const descEl = contentEl.createDiv({ cls: "shadowing-prep-desc" });
    descEl.setText(
      this.existingEnglish
        ? "您已整理過今日日記，您希望重新整理改編，還是直接開始跟讀？"
        : "今日日記尚未整理改編成完整英文文章，您希望："
    );

    const btnContainer = contentEl.createDiv({ cls: "shadowing-prep-btn-col" });

    // Option 1: AI Tidy Up & Shadow
    const tidyBtn = btnContainer.createEl("button", {
      cls: "diary-copilot-prep-tidy-btn",
      text: this.existingEnglish
        ? "✨ 重新呼叫 AI 整理日記 ➔ 存入表達庫並開啟跟讀"
        : "✨ 整理改編成優美文章 ➔ 存入表達庫並開啟跟讀",
    });
    tidyBtn.addEventListener("click", async () => {
      this.close();
      await tidyUpTodayDiary(this.app, this.plugin);
    });

    // Option 2: Shadow directly
    const targetText = this.existingEnglish || this.rawDraftText;
    const rawBtn = btnContainer.createEl("button", {
      cls: "diary-copilot-prep-raw-btn",
      text: this.existingEnglish
        ? "🎧 直接朗讀已整理的英文文章"
        : "📖 直接以現有草稿原文開啟跟讀",
    });
    rawBtn.addEventListener("click", () => {
      this.close();
      new FullTextShadowingModal(this.app, this.plugin, targetText, this.file).open();
    });
  }

  onClose() {
    if (this.pinchZoomCtrl) {
      this.pinchZoomCtrl.cleanup();
      this.pinchZoomCtrl = null;
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}
