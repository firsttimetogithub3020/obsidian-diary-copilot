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
* **當前最新版本**：`v0.3.41`
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
| **v0.3.41** | 2026-11-18 | 1. 頂部更新鈕改為「⚙️ 設定鈕」，點擊彈出上拉選單（Bottom Sheet）。<br/>2. 上拉選單整合：🚀 檢查與重載外掛、🎭 寫作風格切換（社科學術、漢學、自然、內省等風格）、📐 收摺後高度設定（48/60/72/84px）、🔤 卡片字級大小設定（即時縮放）。<br/>3. 設定支援本地獨立記憶與即時生效。<br/>4. 專案版本升級為 v0.3.41。 |
| **v0.3.40** | 2026-11-18 | 1. 點擊潤飾/提問時自動展開字卡（提問預設展開 4 張建議回答）。<br/>2. 修復手機失焦導致語音跟讀無法自動套入筆記問題。<br/>3. 落實方案 3 雙軌感知定位與防黏詞。<br/>4. 更新機制改為偵測 Plugin 資料夾同步狀態並安全重載（擺脫 GitHub 依賴）。 |
| **v0.3.39** | 2026-11-18 | 手指滑動檢閱保持字卡展示，僅在游標落入/鍵盤升起時自動收合。 |
| **v0.3.38** | 2026-11-18 | 還原頂部手柄與手機底部人體工學安全間距，確立 AGENTS.md 守則。 |
| **v0.3.37** | 2026-11-18 | 「整篇跟讀」升級為「✨ 整理跟讀」，整合 AI 智慧整理與全篇沉浸跟讀。 |
| **v0.3.36** | 2026-11-18 | 三層式鍵盤監聽，展開字卡 ⇄ 關閉字卡動態雙向切換。 |
