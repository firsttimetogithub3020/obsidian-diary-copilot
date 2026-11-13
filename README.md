# Diary Copilot

AI 引導式英文日記書寫 Obsidian 外掛（電腦版、平板與手機版 App 通用）。

直接在 Obsidian 的日記筆記裡書寫（支援中英混寫），AI 即時猜測你想寫的內容，在編輯區下方即時顯示 4 種不同風格的道地英文建議卡。寫完後一鍵執行「整理今日日記」，自動產生英文定稿、原文對照與重點表達解析，完整保存在個人的筆記庫中。

- 私人使用，不上架社群外掛市集
- 不需要伺服器、資料庫；資料就是 vault 裡的本機 `.md` 筆記
- AI 驅動：Google Gemini API（預設 Gemini 2.5 Flash-Lite），可在外掛設定中自由切換模型

---

## 核心功能特色

- ✍️ **中英混寫・即時猜測**：直接在筆記中自然輸入（中文、英文、草稿皆可），AI 即時理解語境並猜測你想表達的完整句子。
- 💡 **4 種風格建議卡**：即時呈現 Natural（自然口語）、Casual（輕鬆隨興）、Formal（正式得體）、Idiomatic（道地表達）四種風格卡片，幫助掌握多元語氣。
- 👻 **灰字跟打輔助（Shadow Typing）**：游標後方自動顯示灰色預測字串，按 `Tab` 鍵或點擊卡片即可快速填入。
- 🔄 **打字容錯與極速解鎖**：打字時自動鎖定當前建議卡與灰字，支援 `Backspace` 刪字容錯；按下 `Esc` 鍵可瞬間解鎖並 0ms 重新生成 4 張新建議卡。
- 📁 **資料夾智慧辨識**：預設僅在設定的日記資料夾（例如 `Diary`）自動啟動即時輔助，避免干擾其他專案或工作筆記；在其他資料夾亦可透過指令手動呼叫。
- ✨ **一鍵日記潤飾（One-Tap Polish）**：筆記右上角提供專屬潤飾按鈕（特別針對手機與平板觸控優化），一鍵自動生成專業潤飾後的英文定稿、原文對照與核心詞彙學習筆記。

---

## 文件

| 文件 | 內容 |
|---|---|
| [docs/SPEC.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/docs/SPEC.md) | 完整產品規格（功能、介面、即時呈現策略、存檔格式） |
| [docs/HANDOFF.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/docs/HANDOFF.md) | 給 coding agent（Antigravity）的技術交接：架構、模組、API、驗收條件 |
| [docs/ANTIGRAVITY_PROMPT.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/docs/ANTIGRAVITY_PROMPT.md) | 直接貼給 Antigravity 的第一段指令 |
| [AGENTS.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/AGENTS.md) | coding agent 的工作規則 |

---

## 開發規劃

1. **MVP（已完成）**：電腦與手機版介面、4 張風格建議卡、灰字預測、Backspace 容錯、Esc 鍵解鎖刷新、整理日記功能
2. **第二版**：書寫卡住時的引導提示問題、個人語氣習慣學習
3. **第三版**：自動主題標籤、每週日記回顧、學習進度與用量統計

---

## 安裝方式

### 方法 A：透過 BRAT 外掛安裝（推薦，多裝置同步與自動更新最方便）
1. 在 Obsidian 中安裝並啟用社群外掛 **BRAT**（Beta Reviewer's Auto-update Tool）。
2. 在 BRAT 設定中點擊 **Add Beta plugin**。
3. 輸入儲存庫名稱：`firsttimetogithub3020/obsidian-diary-copilot`。
4. 點擊 **Add Plugin** 完成安裝。
5. 前往 Obsidian 設定 ➔ 社群外掛 ➔ 啟用 **Diary Copilot**，並填入個人的 Gemini API Key 即可。

### 方法 B：手動建置安裝
1. `npm install && npm run build` 產生 `main.js`。
2. 將 `main.js`、`manifest.json`、`styles.css` 複製至 `<vault>/.obsidian/plugins/diary-copilot/`。
3. Obsidian ➔ 設定 ➔ 社群外掛 ➔ 啟用 **Diary Copilot**，並設定 API Key。

> ⚠️ **隱私與安全提示**：個人的 API Key 儲存在 `<vault>/.obsidian/plugins/diary-copilot/data.json`。若您的 Vault 有使用 Git 進行同步，請務必將該檔案加入 Vault 的 `.gitignore` 中，避免金鑰上傳。
