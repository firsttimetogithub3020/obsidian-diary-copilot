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
