# Diary Copilot 永久專案交接與狀態日誌 (Canonical Handover & Status Record)

> [!IMPORTANT]
> **給所有接手此專案的 AI 代理人（Coding Agents）**：
> 當開啟新對話串或接手任務時，**必須優先完整閱讀本文件與 `AGENTS.md`**！
> 嚴禁脫離本文件與使用者的指示擅自猜測架構或引進外部不相容機制。

---

## 一、專案身分與環境資訊

* **專案名稱**：Obsidian Diary Copilot (`obsidian-diary-copilot`)
* **本機代碼倉庫**：`E:\obsidian-english\obsidian-diary-copilot`
* **本機 Vault 部署路徑**：`E:\AI-Knowledge-System\Obsidian-Vault\.obsidian\plugins\diary-copilot`
* **當前最新版本**：`v0.3.46`
* **使用者**：Alan（對話與說明一律使用**繁體中文**；代碼識別碼與 Commit 訊息一律使用英文）。

---

## 二、核心更新與同步架構（最重要規範，絕不可違背）

### 1. 更新閉環（Update Pipeline）
本專案的發布與跨裝置更新**完全遵循以下閉環**，**絕不依賴 GitHub Releases**：
```mermaid
flowchart LR
    A["電腦本機修改代碼"] --> B["npm run build"]
    B --> C["複製到 Vault 插件目錄<br/>(Copy-Item)"]
    C --> D["Obsidian Sync<br/>官方即時雲端同步"]
    D --> E["手機/平板等其他裝置<br/>插件資料夾已就緒"]
    E --> F["裝置端點擊更新按鈕<br/>(偵測資料夾新版並重載)"]
```

### 2. GitHub 的真實定位
* **GitHub 純粹是個人原始碼雲端備份**。
* **嚴禁**在每次功能更新時擅自執行 `gh release create` 或強制依賴 GitHub 下載更新檔。
* 外掛的更新按鈕（`src/services/updater.ts`）**唯一職責是偵測當前裝置內部 Plugin 資料夾內的 `manifest.json` 與檔案**，若有新版（由 Obsidian Sync 送達）即安全呼叫 `window.location.reload()` 重新載入。

---

## 三、目前版本（v0.3.40）核心功能狀態清單

### 1. 自動展開字卡（Auto-Expand Cards）
* **✨ 潤飾（Polish）**：
  * 使用者點擊「✨ 潤飾」時，在 `setLoading()` 階段即自動收合鍵盤、重設手動尺寸鎖定，並在 `applyPanelHeight()` 加入 `!is-loading` 保護，面板直接展開至 390px / 55% 視窗高度，避免縮回 60px。
  * 潤飾完成後先執行 `renderBrowseMode()` 建立卡片群組，隨即自動呼叫 `openCards()`，4 張地道潤飾卡片直接呈現在眼前，無需額外點擊。
  * 點擊「✨ 潤飾」時自動清除先前可能暫留的引導提問條，避免介面衝突。
* **❓ 引導提問（Inquiry）**：
  * 修改 `setPinnedInquiry()`，預設將 `isShowingInquiryAnswers = true`。
  * 使用者點擊「❓ 提問」後，除了固定呈現上方問題條外，下方自動呈現 4 張結構化建議回答字卡（Yes 1/2, No 1/2 或 Open 1/2/3/4），完全不需要使用者手動點擊「💡 查看建議回答」。
  * 右側切換按鈕同步調整為「✍️ 收起建議回答」，點擊可暫時收起查看即時打字續寫。

### 2. 手機語音跟讀與套用（Oral Shadowing & Adoption）
* **失焦問題徹底修復**：`src/main.ts` 新增 `getActiveMarkdownView()`，具備三層防禦 Fallback（標準 `MarkdownView` → DOM 連線快取 `this.activeView` → 工作區 `leaves`），徹底解決手機跟讀時編輯器 blur 導致無法找到編輯器實例的 bug。
* **方案 3 雙軌感知策略（Dual-Context Aware Snap）**：新增 `resolveDualContextSnap()`，在無游標或鍵盤收起狀態下，自動向後吸附至整句標點（`. ! ? 。 ！？`）或單詞邊界（Anti-fragment），並自動進行前綴/後綴空格檢查（Anti-glue），確保插入文字不黏詞、不碎詞。
* **跟讀成功後自動套用**：`executeOralAdoption()` 統一呼叫 `adoptSuggestion(..., "oral")`，70%+ 跟讀成功自動將標準句子套入筆記。
* **行為 A 自動收合**：套用成功後，手機版字卡自動收合為 60px 底部功能列，讓出完整畫面給使用者繼續檢閱或打字。

### 3. 外掛內部資料夾更新偵測（Folder-Based Updater）
* `src/services/updater.ts` 徹底移除對 GitHub 網路請求的依賴。
* 讀取本機 `${app.vault.configDir}/plugins/diary-copilot/manifest.json`：
  * 若資料夾版本 > 記憶體版本（Obsidian Sync 同步了新版）：彈出通知並在 700ms 後執行 `window.location.reload()`。
  * 若使用者手動按下更新鈕：同樣安全重載視窗，確保剛同步進硬碟的最新代碼瞬間生效。

---

## 四、永久開發規範（AGENTS.md 最高守則）

1. **嚴禁更動非目標程式碼（Strict Scope Boundary）**：
   * 最小變更原則（Minimal Blast Radius）：每次修改程式碼，僅限於使用者明確指定修復或調整的功能。
   * 絕對禁止「順帶重構」、「擅自改寫」原本運作正常的樣式、邏輯與佈局。
2. **層級隔離原則（內容歸內容，容器歸容器）**：
   * 隱藏內容只能針對內容子元素（`.diary-copilot-hero-card`, `.diary-copilot-capsule-tabs`）。
   * 絕對禁止在父容器（`.diary-copilot-panel`）上施加破壞性覆蓋（如 `overflow: hidden !important`）。
3. **介面契約永不退化**：
   * 頂部手柄（`top: -24px`）必須保持完全可見、可觸控，面板容器保持 `overflow: visible !important`。
   * 底部安全觸控邊距（`calc(60px + env(safe-area-inset-bottom, 0px))`）絕對不可壓平。
4. **創意思考必先評估影響、先徵詢同意（Propose Before Action）**：
   * 若發現更好的架構設計，嚴禁直接寫入代碼，必須先說明出發點與正反影響，待 Alan 同意後方可著手。

---

## 五、版本修訂紀錄 (Changelog)

| 版本 | 日期 | 重點改動說明 |
| :--- | :--- | :--- |
| **v0.3.46** | 2026-11-18 | 1. 手機端與窄螢幕工具列極致簡化適配：<br/>- 在手機版或窄螢幕時，工具列按鈕自動轉為精煉文字：✨ 整理、❓ 提問、✨ 潤飾、📖 展開 / 🔽 關閉、⚙️（純齒輪圖示）、✕。<br/>- 總寬度縮減至 ~260px，在任何常見手機螢幕（360px~430px）皆能一整排完整呈現，絕不擠壓或截斷。<br/>2. 橫向平滑滑動（Horizontal Scrollable Fallback）：<br/>- 頂部工具列加入 `overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;`。<br/>- 即使使用者將字級放大或在超窄螢幕（< 320px）下，手指輕輕左右滑動即可順暢操作所有功能按鈕。<br/>3. 專案版本升級為 v0.3.46。 |
| **v0.3.45** | 2026-11-18 | 1. ⚙️ 設定選單新增「🎯 英文難度（GEPT 全民英檢）」：<br/>- 支援四大級別：🌱 初級 (國中程度 / A2)、🌿 中級 (高中程度 / B1)、🌳 中高級 (大學程度 / B2)、👑 高級 (專業流利 / C1)。<br/>- 排版完全符合純垂直上下捲動規格，單選即時生效並以 Notice 提示。<br/>2. 全模組精準深度適配：<br/>- 系統 Prompts 核心新增 `getLevelInstructions(level)`，提供清晰的單字量（2200/5000/8000+）、句構複雜度、修辭目標與語調指導。<br/>- 全面貫徹適用於：✨ 整理後跟讀（TidyUp）、✨ 句子潤飾（Polish）、❓ 引導提問與建議回答（Inquiry）、✍️ 即時字卡（Suggestions）、🎙️ 語音口說潤飾（VoiceRefine）。<br/>3. 修復 `CardPanel` 預設層級回退錯誤（`"B1"` → `"upper-intermediate"`）。<br/>4. 專案版本升級為 v0.3.45。 |
| **v0.3.44** | 2026-11-18 | 1. 全篇沉浸影子跟讀（Full-Text Shadowing）彈窗介面徹底重構與修復：<br/>- 底欄控制區隔離於獨立 Dock，配合 `flex-shrink: 0` 永遠固定於彈窗底端，徹底杜絕懸浮覆蓋文字。<br/>- 提詞機滾動區域改為 `flex: 1 1 auto; min-height: 0; overflow-y: auto;`，句子平滑捲動，閱讀與跟讀毫不受擋。<br/>- 句子卡片文字設定 `min-width: 0; width: 0; word-break: break-word;`，修復右側單字被截斷的問題。<br/>- 頂部標題列加入安全右邊距（44px），避讓 Obsidian 原生 `✕` 關閉按鈕，語速選項不再重疊。<br/>- 手機與平板人體工學觸控適配：在螢幕寬度小於 768px 時，控制列自動轉為直列結構，「▶️ 開始朗讀跟讀」按鈕放大為 46px 滿版大拇指觸控熱區，次要按鈕等寬平鋪，單手操作舒適防誤觸。<br/>2. 專案版本升級為 v0.3.44。 |
| **v0.3.43** | 2026-11-18 | 1. 徹底解決桌面端狀態列遮蔽問題：自動量測 Obsidian 狀態列寬度並套用安全間距（`padding-right`），工具列按鈕不再與字數統計/同步圖示重疊。<br/>2. 工具列配色高對比度全面重構：整理跟讀（亮紫/白）、提問（清澈天藍）、潤飾（明亮暖金）、展開/設定按鈕對比全面提升，黑底白字清晰銳利。<br/>3. 關閉提問提示文字由「回續寫」修正為「關閉提問」。<br/>4. 專案版本升級為 v0.3.43。 |
| **v0.3.42** | 2026-11-18 | 1. 方案 1 全面落實：徹底拔除打字被動即時續寫，保留「✨ 潤飾」、「❓ 提問」、「✨ 整理跟讀」與「Alt+1~4」鍵盤快捷鍵。<br/>2. 工具列字級聯動放大：解開按鈕 12px 鎖死，底部工具列字級隨設定等比例同步縮放。<br/>3. 收摺高度真實生效：解開 CSS 與運算限制，支援設定至 100px 或更高，工具列依設定數值等高垂直居中展開。<br/>4. 設定選單全面改為純上下縱向捲動（垂直列表排版），徹底移除左右捲動與左右排版。<br/>5. 專案版本升級為 v0.3.42。 |
| **v0.3.41** | 2026-11-18 | 1. 頂部更新鈕改為「⚙️ 設定鈕」，點擊彈出上拉選單（Bottom Sheet）。<br/>2. 上拉選單整合：🚀 檢查與重載外掛、🎭 寫作風格切換（社科學術、漢學、自然、內省等風格）、📐 收摺後高度設定（48/60/72/84px）、🔤 卡片字級大小設定（即時縮放）。<br/>3. 設定支援本地獨立記憶與即時生效。<br/>4. 專案版本升級為 v0.3.41。 |
| **v0.3.40** | 2026-11-18 | 1. 點擊潤飾/提問時自動展開字卡（提問預設展開 4 張建議回答）。<br/>2. 修復手機失焦導致語音跟讀無法自動套入筆記問題。<br/>3. 落實方案 3 雙軌感知定位與防黏詞。<br/>4. 更新機制改為偵測 Plugin 資料夾同步狀態並安全重載（擺脫 GitHub 依賴）。 |
| **v0.3.39** | 2026-11-18 | 手指滑動檢閱保持字卡展示，僅在游標落入/鍵盤升起時自動收合。 |
| **v0.3.38** | 2026-11-18 | 還原頂部手柄與手機底部人體工學安全間距，確立 AGENTS.md 守則。 |
| **v0.3.37** | 2026-11-18 | 「整篇跟讀」升級為「✨ 整理跟讀」，整合 AI 智慧整理與全篇沉浸跟讀。 |
| **v0.3.36** | 2026-11-18 | 三層式鍵盤監聽，展開字卡 ⇄ 關閉字卡動態雙向切換。 |
