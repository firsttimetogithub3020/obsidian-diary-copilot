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
* **當前最新版本**：`v0.3.55`
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
| **v0.3.55** | 2026-11-18 | 1. 深度強化 iPhone / iPad (iOS WebKit / WKWebView) 跨平台穩定度：<br/>- Web Audio API (AudioContext) 音訊核心升級：針對 iOS Safari / WKWebView 對非同步連續音訊（Autoplay Policy）的嚴格限制，將 TTS 核心升級為 `AudioContext` + 原生 PCM Buffer 拼接。使用者於點擊「▶️ 開始朗讀跟讀」時即主動解鎖 `unlockAudio()`，後續多個句子在 `setTimeout` 連續播放時直接透過 AudioContext PCM 串流輸出，徹底杜絕 iOS `NotAllowedError` 與 Blob URL 在 `app://` 自訂協定下解碼失敗的問題。<br/>- 多層回退保護：AudioContext ➔ 重複使用之 sharedAudio ➔ 系統原生 SpeechSynthesis。<br/>- iOS 人體工學與底部安全邊界修復：跟讀彈窗底部加入 `env(safe-area-inset-bottom)` 安全避讓 iPhone Home Indicator；按鈕網格由 `1fr 1fr 1.25fr` 精準重設為 `1fr 1fr 1fr` 等寬，小螢幕完美對齊。<br/>- iPad 大螢幕與外接鍵盤全面驗證：寬度 >= 640px 自動啟用 2x2 完整網格；窄分屏（Split View 1/3）自動自適應為單卡膠囊分頁；外接鍵盤 Option+1~4 鍵盤事件相容。<br/>2. 專案版本升級為 v0.3.55。 |
| **v0.3.54** | 2026-11-18 | 1. 徹底拔除全篇跟讀對筆記 Frontmatter 的寫入紀錄（落實極簡純粹書寫）：<br/>- 診斷原因：跟讀完成後的 `oral_shadowed` 與 `shadowed_at` 不僅無法為語言習得提供實質教學介入，反而製造了視覺噪音；且原先 Regex 替換存在 non-greedy 缺陷導致時間戳字串反覆串接堆疊成亂碼。<br/>- 徹底拔除：刪除 `recordShadowingCompleted` 方法，跟讀彈窗結束按鈕精簡為「✅ 結束跟讀」，完成時僅於介面給予即時完成提示，100% 絕不更動、不污染使用者的筆記 Markdown 檔案。<br/>2. 專案版本升級為 v0.3.54。 |
| **v0.3.53** | 2026-11-18 | 1. 徹底重構高品質 TTS 語音朗讀核心（解決全篇跟讀頻繁跳句與播放失敗）：<br/>- 診斷原因：原本的第三方 TTS 引擎 `ttsmp3.com` 具備每日 3,000 字元免費額度限制，超額時回傳 `{"Error":"Usage Limit exceeded"}`；第二備援 `dict.youdao.com` 對超過 60 字元的長句回傳 HTTP 500 錯誤；且 `FullTextShadowingModal` 在播放報錯時誤觸 `onEnd()` 回呼，導致連續快轉跳句並觸發滿屏「語音朗讀播放失敗」Notice 彈窗。<br/>- 多層容錯升級（Multi-layer Architecture）：全面升級以 Google 官方即時美音 TTS 串流引擎（`gtx` & `tw-ob`）為第一與第二主引擎，無字數與呼叫次數限制，零延遲高速直傳。<br/>- 長句自然切句與無縫 MP3 Buffer 串接（Seamless Chunk Concatenation）：針對超過 160 字元的長句，自動以標點符號與子句自然切分，平行下載後在記憶體內直接將音訊 ArrayBuffer 串接為單一完整的 MP3 Blob URL，播放完全無縫、零間隙。<br/>- 播放失敗保護機制：`FullTextShadowingModal` 接入 `onError` 防護，當網路異常導致音訊無法播放時，自動原地暫停並保留當前句子高亮，僅跳出一次通知，徹底杜絕骨牌效應式的跳句。<br/>2. 專案版本升級為 v0.3.53。 |
| **v0.3.52** | 2026-11-18 | 1. 徹底根除點擊字卡灰字後接著跟讀的「雙重寫入競態重複（Double Adoption Race Collision）」：<br/>- 診斷原因：點字卡啟動了 `Scheduler` 的鍵盤語音影子跟寫監聽器，隨後開啟 `CardPanel` 跟讀工作台時未清除狀態；使用者說話時兩套系統在 23ms 內相繼判定達標並重複寫入文檔同一個位置。<br/>- 防護 1（狀態隔離）：點擊進入口說跟讀工作台（`startOralShadowing`）時，立即強制呼叫 `onOralStart` 清除 Scheduler 影子狀態與灰字，讓口說跟讀工作台獨佔語音結算權。<br/>- 防護 2（執行互斥）：`onOralShadowComplete` 嚴格檢查 `isOralActive()`，跟讀進行中直接跳過，絕不重複派發。<br/>- 防護 3（原子冪等性保護）：在 `adoptSuggestion` 內建 1500ms 重複寫入攔截防護（Atomic Idempotency Guard），杜絕任何毫秒級重複寫入。<br/>2. 專案版本升級為 v0.3.52。 |
| **v0.3.51** | 2026-11-18 | 1. 頂部功能列新增「📅 今日日記」快捷按鈕：<br/>- 寬螢幕 / 電腦版顯示 `📅 今日日記`，手機 / 窄螢幕自適應精煉顯示 `📅`。<br/>- 採用清爽高對比翡翠綠（Emerald Green）配色，點擊立即呼叫 `openTodayDiary`，一鍵自動開啟或建立乾淨無冗餘標題的今日日記。<br/>2. 專案版本升級為 v0.3.51。 |
| **v0.3.50** | 2026-11-18 | 1. 開啟今日日記不再於內文自動產生 `# 當天日期` 標題：<br/>- 檢視 `src/commands/openToday.ts`，確認原始設定在建立日記新檔案時會自動注入 `# ${todayStr}`。<br/>- 依照指示移除此標題，保留簡潔的 YAML Frontmatter（title, date, created, type: english-diary），讓使用者能直接從乾淨的空白內文開始書寫，不再有冗餘標題干擾。<br/>2. 專案版本升級為 v0.3.50。 |
| **v0.3.49** | 2026-11-18 | 1. 徹底消除電腦端頂部重複的「朗讀、跟讀、填入」按鈕：<br/>- 由於每張字卡內部已皆擁有專屬的 `[ 🔊 朗讀 ] [ 🎙️ 跟讀 ] [ ⚡ 自動填入 ]`，頂部工具列第二排（Row 2）在瀏覽模式下一律隱藏。<br/>- 頂部工具列全面恢復極致純淨，僅保留核心功能鈕（整理跟讀、提問、潤飾、關閉字卡、設定、關閉），徹底消除與字卡內部的按鈕重複。<br/>2. 專案版本升級為 v0.3.49。 |
| **v0.3.48** | 2026-11-18 | 1. 全平台字卡操作行為高度一致化（電腦、平板、手機統一標準）：<br/>- 所有字卡（無論桌面端 2x2 網格或行動端單卡）內部一律具備三個獨立操作按鈕：`[ 🔊 朗讀 ]`（標準 TTS 發音）、`[ 🎙️ 跟讀 ]`（啟動即時口說判定工作台）、`[ ⚡ 自動填入 / ⚡ 填入替換 ]`（直接寫入筆記）。<br/>- 點選字卡本體不再直接自動替換文件，而是觸發「填入灰字（影子跟寫練習）」！<br/>2. 恢復手機與平板端的「Alt+1~4 / 填入灰字」跟寫功能：<br/>- 解除行動端強制直接填入（Direct Paste）限制，在手機、平板與桌面端一致支援灰字跟寫練習。<br/>- 字卡標題列在全平台（包含手機與平板外接鍵盤使用者）恢復呈現快捷鍵提示（如 `Alt+1` ~ `Alt+4`）。<br/>3. 跟讀模式人體工學大按鈕升級（Thumb-friendly Ergonomics）：<br/>- 在語音跟讀工作台（Oral Studio）內部新增底置大尺寸操作區塊（`.diary-copilot-oral-dock-controls`），包含「🔊 聽示範」、「⏹️ 說完了 / 🔄 重試」、「⚡ 直接填入」、「✕ 取消」。<br/>- 按鈕高度全面設定為 42px～44px，具備舒適的點擊熱區與清晰文字，在手機單手操作下絕不卡手、誤觸或太小。<br/>4. 專案版本升級為 v0.3.48。 |
| **v0.3.47** | 2026-11-18 | 1. 整理後跟讀雙介面（ShadowingPrepModal ＆ FullTextShadowingModal）雙指縮放字級：<br/>- 支援行動端雙指捏合/張開（Pinch-to-zoom）手勢與桌面端 Ctrl+滾輪手勢，字級在 12px～32px 自由即時無段縮放。<br/>- 放大後文字自動折行（Auto Word-Wrap）：單行容納不下時自然向下折成多行，排版絕不破圖或被右側截斷。<br/>- 縮放時即時浮現字級懸浮提示（🔤 18px），縮放結束後自動記憶偏好至設定。<br/>- 單指滑動不受任何干擾，平滑滾動瀏覽維持 100% 流暢原生體驗。<br/>2. 專案版本升級為 v0.3.47。 |
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
