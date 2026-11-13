import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type DiaryCopilotPlugin from "./main";
import { PluginSettings, DiaryTone } from "./types";

export const DEFAULT_SETTINGS: PluginSettings = {
  geminiApiKey: "",
  model: "gemini-3.5-flash-lite",
  tidyModel: "gemini-3.5-flash-lite",
  diaryFolder: "Diary",
  englishLevel: "upper-intermediate",
  diaryTone: "casual",
  debounceMs: 400,
  noPunctuationDebounceMs: 800,
  guidanceDelaySec: 20,
  showGhostText: true,
  dailyRequestLimit: 1500,
  cardMinHeight: 64,
  cardMaxLines: 3,
  panelMinHeight: 115,
};

export const DIARY_TONE_OPTIONS: { id: DiaryTone; label: string; desc: string }[] = [
  { id: "casual", label: "日常自然 (Casual)", desc: "自然親切的日常母語口語表達" },
  { id: "reflective", label: "自我對話 (Reflective)", desc: "內省沉思、情緒覺察與個人深度思考" },
  { id: "motivational", label: "正向激勵 (Empowering)", desc: "肯定進步、感恩視角與行動力量" },
  { id: "vivid", label: "生動故事 (Vivid)", desc: "注重五感描寫與畫面感" },
  { id: "humorous", label: "幽默自嘲 (Humorous)", desc: "輕鬆自嘲與俏皮筆調" },
  { id: "social-science", label: "社科學術期刊 (Social Science)", desc: "社會科學學術期刊論文語調：精準學術術語、概念化框架、客觀分析、嚴謹論述" },
  { id: "sinology", label: "漢學學術期刊 (Sinology)", desc: "漢學學術期刊論文語調：西方漢學/中國研究學術風格，善用文獻考據、義理辨析、歷史脈絡與學術英譯" },
];

export const RECOMMENDED_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite（最快、超低延遲，推薦）" },
  { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite Latest（自動保持最新 Flash-Lite）" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash（高智能、快速）" },
  { id: "gemini-flash-latest", label: "Gemini Flash Latest（自動保持最新 Flash）" },
];

export class DiaryCopilotSettingTab extends PluginSettingTab {
  plugin: DiaryCopilotPlugin;

  constructor(app: App, plugin: DiaryCopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Diary Copilot 設定" });

    // Informational note
    const infoBox = containerEl.createDiv({ cls: "setting-item-description" });
    infoBox.style.marginBottom = "14px";
    infoBox.style.padding = "8px 12px";
    infoBox.style.borderRadius = "6px";
    infoBox.style.backgroundColor = "var(--background-secondary)";
    infoBox.innerHTML = `
      <b>💡 私人使用說明</b>：此 API Key 僅儲存於您目前的裝置或 Vault（<code>data.json</code>），兩位使用者可各自填入獨立申請的 Google Gemini API Key。絕不會上傳或公開。
    `;

    // Gemini API Key
    new Setting(containerEl)
      .setName("Gemini API Key")
      .setDesc("請至 Google AI Studio 申請個人專用 API Key")
      .addText((text) => {
        text
          .setPlaceholder("AQ.Ab8...")
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.style.width = "220px";
      })
      .addButton((btn) => {
        btn.setButtonText("測試連線").onClick(async () => {
          if (!this.plugin.settings.geminiApiKey) {
            new Notice("請先輸入 Gemini API Key");
            return;
          }
          btn.setButtonText("連線中...").setDisabled(true);
          try {
            const ok = await this.plugin.testGeminiConnection();
            if (ok) {
              new Notice("✅ Gemini API 連線成功！");
            } else {
              new Notice("❌ 連線失敗，請檢查 API Key 是否正確。");
            }
          } catch (e: any) {
            new Notice(`❌ 連線錯誤: ${e?.message || e}`);
          } finally {
            btn.setButtonText("測試連線").setDisabled(false);
          }
        });
      });

    // Realtime Suggestion Model
    new Setting(containerEl)
      .setName("建議用模型")
      .setDesc("用於打字時即時猜測與建議（預設最新 Gemini 3.5 Flash-Lite）")
      .addDropdown((dropdown) => {
        for (const m of RECOMMENDED_MODELS) {
          dropdown.addOption(m.id, m.label);
        }
        dropdown.addOption("custom", "自訂模型 ID...");
        const currentModel = this.plugin.settings.model;
        const isPreset = RECOMMENDED_MODELS.some((m) => m.id === currentModel);
        dropdown.setValue(isPreset ? currentModel : "custom");

        dropdown.onChange(async (val) => {
          if (val !== "custom") {
            this.plugin.settings.model = val;
            await this.plugin.saveSettings();
            this.display();
          } else {
            this.display();
          }
        });
      });

    // Custom model input if selected or custom
    const isCustomModel = !RECOMMENDED_MODELS.some((m) => m.id === this.plugin.settings.model);
    if (isCustomModel) {
      new Setting(containerEl)
        .setName("自訂建議模型 ID")
        .setDesc("輸入 Google Gemini API 支援的 Model ID（例如 gemini-3.5-flash-lite）")
        .addText((text) => {
          text
            .setValue(this.plugin.settings.model)
            .onChange(async (val) => {
              this.plugin.settings.model = val.trim();
              await this.plugin.saveSettings();
            });
        });
    }

    // Tidy up model
    new Setting(containerEl)
      .setName("整理用模型")
      .setDesc("執行「整理今日日記」指令時使用的模型")
      .addDropdown((dropdown) => {
        for (const m of RECOMMENDED_MODELS) {
          dropdown.addOption(m.id, m.label);
        }
        dropdown.setValue(this.plugin.settings.tidyModel || "gemini-3.5-flash-lite");
        dropdown.onChange(async (val) => {
          this.plugin.settings.tidyModel = val;
          await this.plugin.saveSettings();
        });
      });

    // Diary folder
    new Setting(containerEl)
      .setName("日記資料夾")
      .setDesc("外掛僅在此資料夾內的筆記觸發即時建議（預設 Diary）")
      .addText((text) => {
        text
          .setPlaceholder("Diary")
          .setValue(this.plugin.settings.diaryFolder)
          .onChange(async (value) => {
            this.plugin.settings.diaryFolder = value.trim() || "Diary";
            await this.plugin.saveSettings();
          });
      });

    // English Level
    new Setting(containerEl)
      .setName("英文程度偏好")
      .setDesc("控制 AI 建議卡片的單字難度與句構複雜度")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("beginner", "初級 (Beginner)")
          .addOption("intermediate", "中級 (Intermediate)")
          .addOption("upper-intermediate", "中高級 (Upper-Intermediate)")
          .addOption("advanced", "高級 (Advanced)")
          .setValue(this.plugin.settings.englishLevel)
          .onChange(async (val) => {
            this.plugin.settings.englishLevel = val as any;
            await this.plugin.saveSettings();
          });
      });

    // Diary Tone
    new Setting(containerEl)
      .setName("預設寫作語調")
      .setDesc("控制 AI 建議與潤飾的行文風格（亦可直接在底部面板頂部隨時切換）")
      .addDropdown((dropdown) => {
        for (const t of DIARY_TONE_OPTIONS) {
          dropdown.addOption(t.id, t.label);
        }
        dropdown.setValue(this.plugin.settings.diaryTone || "casual");
        dropdown.onChange(async (val) => {
          this.plugin.settings.diaryTone = val as any;
          await this.plugin.saveSettings();
        });
      });

    // Ghost text toggle (Desktop)
    new Setting(containerEl)
      .setName("顯示灰色預測字 (Desktop)")
      .setDesc("在電腦版游標後方直接顯示卡 1 的預測文字（按 Tab 即可採納）")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showGhostText)
          .onChange(async (val) => {
            this.plugin.settings.showGhostText = val;
            await this.plugin.saveSettings();
          });
      });

    // UI Appearance Customization
    containerEl.createEl("h3", { text: "卡片外觀與版面設定" });

    new Setting(containerEl)
      .setName("底部面板整體高度 (像素)")
      .setDesc("編輯區底部整塊建議卡片面板的最小高度（預設 115px）")
      .addSlider((slider) => {
        slider
          .setLimits(70, 220, 5)
          .setValue(this.plugin.settings.panelMinHeight || 115)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.panelMinHeight = val;
            await this.plugin.saveSettings();
            this.plugin.applyAppearanceSettings();
          });
      });

    new Setting(containerEl)
      .setName("建議卡片高度 (像素)")
      .setDesc("每張建議卡片的最小高度（預設 64px）")
      .addSlider((slider) => {
        slider
          .setLimits(40, 140, 4)
          .setValue(this.plugin.settings.cardMinHeight || 64)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.cardMinHeight = val;
            await this.plugin.saveSettings();
            this.plugin.applyAppearanceSettings();
          });
      });

    new Setting(containerEl)
      .setName("卡片文字最多顯示行數")
      .setDesc("卡片文字在展開前最多折行顯示的行數（預設 3 行）")
      .addSlider((slider) => {
        slider
          .setLimits(1, 6, 1)
          .setValue(this.plugin.settings.cardMaxLines || 3)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.cardMaxLines = val;
            await this.plugin.saveSettings();
            this.plugin.applyAppearanceSettings();
          });
      });

    // Advanced Trigger Timing
    containerEl.createEl("h3", { text: "即時觸發與效能設定" });

    new Setting(containerEl)
      .setName("標點／空格停頓觸發延遲 (毫秒)")
      .setDesc("打完逗號、句號、空格後暫停多久開始向 AI 請求建議（預設 400ms）")
      .addSlider((slider) => {
        slider
          .setLimits(200, 1500, 50)
          .setValue(this.plugin.settings.debounceMs)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.debounceMs = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("無標點長句觸發延遲 (毫秒)")
      .setDesc("持續書寫但未打標點時的延遲（預設 800ms）")
      .addSlider((slider) => {
        slider
          .setLimits(400, 2000, 100)
          .setValue(this.plugin.settings.noPunctuationDebounceMs)
          .setDynamicTooltip()
          .onChange(async (val) => {
            this.plugin.settings.noPunctuationDebounceMs = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("每日請求上限")
      .setDesc("防止異常循環請求的保護上限（預設 1500 次）")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.dailyRequestLimit))
          .onChange(async (val) => {
            const num = parseInt(val, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.dailyRequestLimit = num;
              await this.plugin.saveSettings();
            }
          });
      });

    // Today's Usage
    const todayStr = new Date().toISOString().slice(0, 10);
    const dayUsage = this.plugin.data.usage[todayStr] || { requests: 0, inputTokens: 0, outputTokens: 0 };
    containerEl.createEl("h3", { text: "今日使用量統計" });
    const usageBox = containerEl.createDiv({ cls: "setting-item-description" });
    usageBox.innerHTML = `
      <p>今日累計請求次數：<b>${dayUsage.requests}</b> / ${this.plugin.settings.dailyRequestLimit} 次</p>
      <p>今日 Token 用量：輸入約 <b>${dayUsage.inputTokens}</b> tokens，輸出約 <b>${dayUsage.outputTokens}</b> tokens</p>
      <p style="color: var(--text-faint); font-size: 11px;">Gemini 3.5 Flash-Lite 費率極低，個人日記每日費用幾乎趨近於零。</p>
    `;
  }
}
