import { App, Modal, TFile } from "obsidian";
import type DiaryCopilotPlugin from "../main";
import { tidyUpTodayDiary } from "../commands/tidyUp";
import { FullTextShadowingModal } from "./fullTextShadowingModal";

export class ShadowingPrepModal extends Modal {
  private plugin: DiaryCopilotPlugin;
  private rawDraftText: string;
  private file: TFile;

  constructor(app: App, plugin: DiaryCopilotPlugin, rawDraftText: string, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.rawDraftText = rawDraftText;
    this.file = file;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("diary-copilot-shadowing-prep-modal");

    contentEl.createEl("h3", { text: "🎧 長篇跟讀準備" });

    const descEl = contentEl.createDiv({ cls: "shadowing-prep-desc" });
    descEl.setText("今日日記尚未整理改編成完整英文文章，您希望：");

    const btnContainer = contentEl.createDiv({ cls: "shadowing-prep-btn-col" });

    // Option 1: AI Tidy Up & Shadow
    const tidyBtn = btnContainer.createEl("button", {
      cls: "diary-copilot-prep-tidy-btn",
      text: "✨ 整理改編成優美文章 ➔ 開啟跟讀",
    });
    tidyBtn.addEventListener("click", async () => {
      this.close();
      await tidyUpTodayDiary(this.app, this.plugin);
    });

    // Option 2: Shadow raw draft directly
    const rawBtn = btnContainer.createEl("button", {
      cls: "diary-copilot-prep-raw-btn",
      text: "📖 直接以現有草稿原文跟讀",
    });
    rawBtn.addEventListener("click", () => {
      this.close();
      new FullTextShadowingModal(this.app, this.plugin, this.rawDraftText, this.file).open();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
