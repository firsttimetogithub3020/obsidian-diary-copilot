# Diary Copilot

> 💡 **AI 引導式英文日記書寫 Obsidian 外掛（電腦版、平板與手機版 App 通用）**

**Diary Copilot** 讓你能直接在 Obsidian 的日常筆記中自然書寫（支援中英混寫與草稿）。AI 會在背景即時理解你的寫作語境，在編輯區下方提供 **4 種不同語氣風格的道地英文建議卡**，並以**灰字跟打（Shadow Typing）**輔助你完成句子。

寫完日記後，執行「**整理今日日記**」，即可一鍵產出**「英文定稿 ＋ 撰寫初稿對照 ＋ 繁體中文對照 ＋ 重點表達解析」**，並自動彙總至個人的核心表達庫（`Expressions.md`），讓你能夠隨時一次性複習所有累積的道地單字與片語！

- 🔒 **本機安全與隱私**：無需外部資料庫或伺服器，日記與表達庫純粹是 Vault 內的 `.md` 檔案；API Key 僅儲存於本機。
- ⚡ **AI 驅動**：支援 Google Gemini API（預設 Gemini 2.5 Flash-Lite），可在設定中隨時切換模型。
- 📱 **多端體驗優化**：針對電腦鍵盤快捷鍵、平板與手機觸控點擊均經過深度介面調校。

---

## 核心功能特色

- ✍️ **中英混寫・即時猜測**：直接在筆記中輸入中文、英文或混寫草稿，AI 即時猜測你想表達的完整句子，不再因「卡單字」中斷思維。
- 💡 **4 種風格建議卡**：即時呈現 Natural（自然口語）、Casual（輕鬆隨興）、Formal（正式得體）、Idiomatic（道地俚語）四種表達，擴展英文思維廣度。
- 👻 **灰字跟打輔助（Shadow Typing）**：游標後方自動顯示灰色預測字串，按 `Tab` 鍵或點擊卡片即可快速填入，兼顧輸入速度與跟打肌肉記憶。
- 🔄 **打字容錯與極速解鎖**：打字時自動鎖定當前卡片與灰字，支援 `Backspace` 刪字容錯；隨時按 `Esc` 鍵可瞬間解鎖並以 0ms 延遲重新生成 4 張新建議卡。
- ✨ **單句深度潤飾（F3 / ✨按鈕）**：寫作途中若想針對特定句子「換句話說」，按下 `F3` 或面板頂部「✨ 潤飾」按鈕，立即提供 4 種改寫視角。
- 📚 **全篇雙語整理（Tidy Up）**：寫完日記後執行「整理今日日記」，自動生成結構完整的雙語日記（英文定稿、原文初稿、中文對照、重點單字解析）。
- 🔗 **自動彙總核心表達庫（Expressions Hub）**：每次整理日記，自動將今日新學的表達同步追加至 `Diary/Expressions.md`，支援雙向無縫跳轉，隨時一覽所有累積片語！
- 📁 **資料夾智慧辨識**：預設僅在專屬日記資料夾（例如 `Diary`）自動啟動，不干擾其他專案或工作筆記；在其他資料夾亦可透過指令手動啟用。

---

## 使用說明與操作指南

### 1. 日常寫作流程（3 步驟）

```
[步驟 1：動筆寫作] ──▶ [步驟 2：即時卡片/跟打] ──▶ [步驟 3：寫完一鍵整理]
中英混寫或英文草稿     Alt+1~4 採納 / Esc 刷新      Ctrl+P 執行「整理今日日記」
```

#### 步驟 1：開始動筆
1. 在 Obsidian 的日記資料夾（預設為 `Diary/`）中建立或開啟今天的筆記（例如 `2026-11-13.md`）。
   - *提示：也可以直接在指令面板執行「開啟今日日記」快速前往。*
2. 直接在編輯區輸入內容。你可以直接寫英文初稿、也可以中英混寫（例如：「今天的工作真的很累，I feel like I need a break」）。

#### 步驟 2：選擇建議與跟打練習
1. 輸入文字後停頓約 0.3 秒，底部面板即時跳出 **4 張不同語氣的建議卡片**，編輯區游標後方會出現灰色預測字串。
2. **採納建議**：
   - 按下快捷鍵 `Alt + 1`、`Alt + 2`、`Alt + 3`、`Alt + 4`，或直接**滑鼠/手指點擊卡片**。
   - 若當前句子有中文，該中文會自動替換，並將英文建議字串轉為灰字供你練習。
3. **快速補全**：
   - 按下 `Tab` 鍵，即可一秒將灰字補全填入編輯區。
4. **重新刷新建議**：
   - 如果當前 4 張卡片都不滿意，隨時按下鍵盤 `Esc` 鍵，系統會瞬間解鎖並以 0ms 延遲重新生成 4 張全新建議卡。
5. **單句深度潤飾（F3）**：
   - 如果對寫好的某一句話不滿意，將游標停在該句，按下 `F3`（或點擊面板頂部的「✨ 潤飾」按鈕），AI 會即時針對這句話提供 4 種進階改寫風格。

#### 步驟 3：寫完一鍵整理
1. 日記寫完後，按下快捷鍵 `Ctrl + P`（Mac 為 `Cmd + P`，手機版點擊指令圖示）。
2. 輸入並執行：**`整理今日日記`**（Tidy up today's diary）。
3. 系統將在背景完成備份，並自動將筆記排版為專業漂亮的雙語學習格式（見下方產出範例）。
4. 今日學到的核心單字與片語會自動同步追加到 `Diary/Expressions.md`！

---

### 2. 快捷鍵與操作速查表

| 操作方式 / 快捷鍵 | 功能說明 | 適用情境 |
|---|---|---|
| `Alt + 1 / 2 / 3 / 4` | 採納第 1 ~ 4 張建議卡 | 電腦版鍵盤快速選擇 |
| **滑鼠點擊 / 手指觸控** | 點擊任意一張卡片直接採納 | 電腦、iPad、手機平板皆通用 |
| `Tab` | 一鍵採納當前灰字預測 | 快速補全整句英文 |
| `Esc` | 解鎖卡片與灰字，0ms 重新生成建議 | 想要換一批新建議時 |
| `Backspace` | 退格刪字容錯 | 打字打錯時退格修正，不會打斷鎖卡 |
| `F3` 或 點擊「✨ 潤飾」 | 深度潤飾游標所在句子（4 種風格） | 針對特定句子精修表達 |
| `Ctrl + P` ➔ **整理今日日記** | 整篇日記整理為定稿、原稿對照與片語庫 | 整篇寫完後的收尾定稿 |
| 點擊左側邊欄 **✨ 圖示** | 手動為當前筆記開啟／關閉 Copilot | 在日記資料夾外的筆記書寫時 |

---

### 3. 整理後的日記格式範例

執行「整理今日日記」後，當天筆記（例如 `Diary/2026-11-13.md`）會自動生成為以下結構：

```markdown
---
date: 2026-11-13
type: english-diary
mood: [inspired, reflective]
topics: [learning, ai, english]
level: upper-intermediate
related: ["[[AI學習日記]]", "[[思維習慣]]"]
---

## English
Honestly, this is such a better way to pick up English. Instead of just translating, I'm finally starting to think in English. This is how AI helps us learn, and this is also how learning should be truly integrated with AI. In our modern world, people who refuse to adopt AI will probably be left behind.

## 撰寫初稿
Honestly, this is such a better way to pick up English. Instead of just translating, I'm finally starting to think in English. This is how AI help us to learn, and this is also how learning should be trully integrated with AI.
In our modern world, people who refuse to adapt AI probably will beleft behind.

## 中文對照
老實說，這真的是學英文更好的方式。比起單純翻譯，我終於開始嘗試用英文思考了。這正是 AI 協助我們學習的真諦，也是學習應當如何與 AI 深度融合的方式。在現代世界中，抗拒使用 AI 的人很可能會被時代拋在後頭。

## Today's expressions
- **pick up [language]** — 自然學會、習得（比單純的 learn 更道地生動）
- **think in English** — 用英文思維思考
- **be left behind** — 被拋在後頭、脫節
- **adopt vs. adapt** — adopt 為採納/採用；adapt 為適應

> 📖 查看歷史累積的全部表達：[[Expressions|📚 點此一次瀏覽全部表達庫]]
```

---

### 4. 核心表達庫（`Diary/Expressions.md`）使用方式

為了避免每天學到的單字零散在各篇日記中難以複習，外掛會自動維護一份彙總筆記：

- **檔案位置**：`Diary/Expressions.md`（與日記資料夾同目錄）。
- **一次閱讀所有片語**：隨時打開此檔案，就能由新到舊順暢瀏覽每天累積的道地片語與中文解析。
- **雙向跳轉無縫回溯**：
  - 在 `Expressions.md` 點擊日期標題（如 `[[2026-11-13]]`），立即跳回該篇日記查看當時語境。
  - 在任何一篇日記末尾點擊 `[[Expressions]]`，立即返回表達庫大清單。

```markdown
# 📚 英文日記核心表達庫 (Expressions Hub)

本筆記由「整理今日日記」自動彙總每天學到的核心表達、單字與道地片語。點擊日期標題即可跳轉至當日完整日記。

---

## [[2026-11-13]]
- **pick up [language]** — 自然學會、習得（比單純的 learn 更道地生動）
- **think in English** — 用英文思維思考
- **be left behind** — 被拋在後頭、脫節
- **adopt vs. adapt** — adopt 為採納/採用；adapt 為適應

## [[2026-11-12]]
- **wrap up the day** — 結束今天的一天
- **take a breather** — 稍作喘息、放鬆一下
```

---

## 安裝方式

### 方法 A：透過 BRAT 外掛安裝（推薦，多裝置自動更新最方便）
1. 在 Obsidian 中安裝並啟用社群外掛 **BRAT**（Beta Reviewer's Auto-update Tool）。
2. 進入 BRAT 設定頁面，點擊 **Add Beta plugin**。
3. 輸入儲存庫路徑：
   ```text
   firsttimetogithub3020/obsidian-diary-copilot
   ```
4. 點擊 **Add Plugin** 完成安裝。
5. 前往 Obsidian「設定」➔「第三方外掛程式」➔ 啟用 **Diary Copilot**，並在設定中貼上個人的 Google Gemini API Key 即可！

### 方法 B：手動建置安裝（開發者適用）
1. 複製專案後執行建置指令：
   ```bash
   npm install && npm run build
   ```
2. 將產生的 `main.js`、`manifest.json`、`styles.css` 複製至：
   `<你的 Vault>/.obsidian/plugins/diary-copilot/`
3. 在 Obsidian 設定中啟用外掛並填入 API Key。

> ⚠️ **隱私安全提示**：個人的 API Key 儲存在 `<vault>/.obsidian/plugins/diary-copilot/data.json`。若您的 Vault 有使用 Git 進行同步，請務必將該檔案加入 Vault 的 `.gitignore` 中，以防止金鑰意外上傳。

---

## 設定選項說明

在 Obsidian「設定」➔「Diary Copilot」中可自訂以下選項：

- **Gemini API Key**：填入個人的 Google Gemini API Key（支援即時連線測試驗證）。
- **即時建議模型**：預設為 `gemini-2.5-flash-lite`（反應速度極快，延遲低至 300~500ms）。
- **日記整理模型**：預設為 `gemini-2.5-flash-lite`（亦可切換至 `gemini-2.5-pro` 進行更高水準的深度潤飾）。
- **日記資料夾路徑**：預設為 `Diary`（僅在此資料夾內的筆記自動開啟 AI 輔助，避免打擾其他筆記）。
- **在所有資料夾啟用**：開啟後可在筆記庫中的任意檔案使用即時建議。
- **英文程度目標**：可選擇 `beginner`、`intermediate`、`upper-intermediate` 或 `advanced`，AI 會依據所選程度調整句構與用字深度。
- **預設書寫語氣（Tone）**：提供 Natural（自然日常）、Reflective（內省深度）、Motivational（正向積極）、Vivid（生動描寫）、Humorous（幽默風趣）等多種語氣選擇。
- **建議卡文字大小與面板高度**：支援自由微調建議卡字體大小（px）與面板預設最小高度。

---

## 文件清單

| 文件路徑 | 說明內容 |
|---|---|
| [docs/SPEC.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/docs/SPEC.md) | 完整產品規格（架構設計、介面流程、即時策略、存檔格式規範） |
| [docs/HANDOFF.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/docs/HANDOFF.md) | 技術交接手冊（模組劃分、API 規格、測試與驗收標準） |
| [docs/ANTIGRAVITY_PROMPT.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/docs/ANTIGRAVITY_PROMPT.md) | Antigravity AI Agent 初始引導提示詞 |
| [AGENTS.md](https://github.com/firsttimetogithub3020/obsidian-diary-copilot/blob/main/AGENTS.md) | Coding Agent 規範與工作守則 |
