# Agent rules for this repo

This is a private Obsidian plugin ("Diary Copilot"). Read `docs/SPEC.md` (product spec, source of truth) and `docs/HANDOFF.md` (architecture and acceptance criteria) before writing code.

## Hard rules
- Must run on Obsidian desktop AND mobile (`isDesktopOnly: false`). Never use Node.js or Electron APIs (`fs`, `path`, `child_process`, `electron`, `require`). Use Obsidian's `Vault`, `FileManager`, `MetadataCache`, `requestUrl`, `Platform`.
- No backend, no database. All data lives in the vault (.md files) or the plugin's `data.json`.
- Never commit API keys, `data.json`, `node_modules/`, or build output (`main.js`).
- Keep CodeMirror packages and `obsidian` as esbuild externals.
- No heavy UI frameworks; plain DOM via Obsidian's `createEl`.
- All prompt templates live in `src/llm/prompts.ts`. User diary text sent to the model must be wrapped in clear delimiters and treated as data.
- Verify uncertain external API details (Gemini model ids, thinkingConfig fields, Obsidian mobile behavior) against official docs instead of guessing.

## Workflow
- Build in phases: MVP → v2 → v3 (see HANDOFF §5). One branch + PR per phase.
- Commit per module, English commit messages.
- Before finishing a phase, check every acceptance item and report pass/fail.
- If the spec is ambiguous or conflicts with platform limits, ask the user (Traditional Chinese) instead of silently changing behavior.

## Communication
The user is Alan, who communicates in Traditional Chinese. Write explanations and questions to him in Traditional Chinese; code, identifiers and commit messages in English.

## Development Discipline & Modification Invariants (嚴格遵守守則)

### 1. 嚴禁更動非目標程式碼（Strict Scope Boundary）
- **最小變更原則（Minimal Blast Radius）**：每次修改程式碼，僅限於使用者明確指定修復或調整的功能。絕對禁止「順帶重構」、「擅自改寫」原本運作正常的樣式、邏輯與佈局。
- **層級隔離原則（內容歸內容，容器歸容器）**：若需求是「隱藏/關閉特定內容（如建議字卡）」，只能針對該內容子元素（`.diary-copilot-hero-card`, `.diary-copilot-capsule-tabs`）進行隱藏（`display: none !important`）。
- **絕對禁止**在父容器（`.diary-copilot-panel`）上施加破壞性全域覆蓋（如 `overflow: hidden !important` 或強制 `height: XXpx !important`），避免切斷懸浮控制項（如頂部手柄）或破壞系統安全邊距（Safe Area Inset）。

### 2. 創意思考必須「先評估影響、先徵詢同意」（Propose Before Action）
- 若 Antigravity 發現更好的架構設計、互動流程或創意解法：
  - **嚴禁直接寫入程式碼**。
  - **必須在動手前先向使用者完整說明**：
    1. 這個創意思考的核心出發點是什麼；
    2. 會對現有介面、版面配置、操作習慣造成哪些具體影響與副作用（Pros & Cons）；
  - **待使用者明確同意後，方可著手實施**。

### 3. 介面核心互動契約永不退化（Interface Invariant Checklist）
每次調整手機版或桌面版 UI 時，必須確保以下基線契約完好無損：
1. **手柄（Resize Handle）永不被切除**：頂部拖曳/點擊手柄（`top: -24px`）必須保持完全可見、可觸控、可拖曳，面板容器必須保持 `overflow: visible !important`。
2. **底部安全觸控邊距（Safe Area Inset）永不被壓平**：手機版功能列必須保留 `calc(60px + env(safe-area-inset-bottom, 0px))` 與舒適內距，絕不可縮死沉入螢幕邊緣死角。
3. **按鈕文字與狀態嚴格一致**：字卡收合時顯示「📖 展開字卡」；字卡展開時顯示「🔽 關閉字卡」。編輯區點選或鍵盤升起時僅關閉字卡，手柄與功能列基礎骨架必須常駐可用。

