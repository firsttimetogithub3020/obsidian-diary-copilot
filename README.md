# Diary Copilot

AI 引導式英文日記書寫 Obsidian 外掛（電腦版＋手機版 App 通用）。

直接在 Obsidian 的日記筆記裡書寫（可中英混寫），AI 即時猜測你想寫的內容，在編輯區下方顯示 1–3 張英文建議卡。寫完執行「整理今日日記」，自動產生英文定稿、中文原稿與今日表達，成為筆記庫內容，供「我的思考區」使用。

- 私人使用，不上架社群外掛市集
- 不需要伺服器、資料庫；資料就是 vault 裡的 .md 檔
- AI：Gemini API（預設 Gemini 3.5 Flash-Lite），可在設定切換模型

## 文件

| 文件 | 內容 |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | 完整產品規格（功能、介面、即時呈現策略、存檔格式） |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 給 coding agent（Antigravity）的技術交接：架構、模組、API、驗收條件 |
| [docs/ANTIGRAVITY_PROMPT.md](docs/ANTIGRAVITY_PROMPT.md) | 直接貼給 Antigravity 的第一段指令 |
| [AGENTS.md](AGENTS.md) | coding agent 的工作規則 |

## 開發階段

1. **MVP**：電腦版、建議卡、灰字預測、整理指令
2. **第二版**：手機版介面、卡住時的引導問題、語氣學習
3. **第三版**：自動標籤與思考區整合、每週回顧、用量統計

## 安裝（私人）

1. `npm install && npm run build` 產生 `main.js`
2. 把 `main.js`、`manifest.json`、`styles.css` 複製到 `<vault>/.obsidian/plugins/diary-copilot/`
3. Obsidian → 設定 → 第三方外掛 → 啟用 Diary Copilot，在設定頁貼上 Gemini API key
4. 手機：透過 vault 同步，或用 BRAT 外掛＋GitHub token 從本 private repo 安裝

> ⚠️ API key 存在 `<vault>/.obsidian/plugins/diary-copilot/data.json`。若 vault 用 Git 同步，務必把此檔加入 vault 的 `.gitignore`。
