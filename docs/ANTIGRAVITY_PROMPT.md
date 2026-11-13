# 貼給 Antigravity 的第一段指令

把以下整段複製貼上（clone repo 並在 Antigravity 開啟此資料夾後使用）：

---

你要在這個 repo 實作一個 Obsidian 外掛「Diary Copilot」：AI 引導式英文日記書寫工具，桌面與手機 Obsidian App 都要能用。

請先完整閱讀以下文件，再開始動手：
1. `AGENTS.md`：工作規則（必須遵守）
2. `docs/SPEC.md`：產品規格，是需求的唯一依據
3. `docs/HANDOFF.md`：技術架構、模組切分、API 細節、驗收條件

現在請做 **MVP 階段**（HANDOFF §5 的 MVP 清單）：
1. 以 obsidian-sample-plugin 的結構建立專案骨架（TypeScript + esbuild），`isDesktopOnly: false`
2. 依 HANDOFF §3 的模組架構實作
3. 先做一個最小可驗證版本：設定頁可輸入 Gemini API key → 在 `Diary/` 筆記中停頓後顯示卡 1。確認 Gemini 串流在 Obsidian 內可行（含 CORS），再往下做其餘功能
4. 完成後逐項對照 MVP 驗收條件回報結果，未通過的項目說明原因

開始前，先列出你的實作計畫與任何對規格的疑問；Gemini 的 model id 與 thinking 設定欄位請查官方文件確認後再寫。
