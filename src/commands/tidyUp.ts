import { App, MarkdownView, Notice, TFile } from "obsidian";
import type DiaryCopilotPlugin from "../main";
import { buildTidySystemPrompt, buildTidyUserPrompt } from "../llm/prompts";

export async function tidyUpTodayDiary(app: App, plugin: DiaryCopilotPlugin) {
  const activeView = app.workspace.getActiveViewOfType(MarkdownView);
  if (!activeView || !activeView.file) {
    new Notice("請先在日記檔案中執行此指令。");
    return;
  }

  const file = activeView.file;
  const diaryFolder = plugin.settings.diaryFolder || "Diary";
  if (!file.path.startsWith(diaryFolder + "/")) {
    new Notice(`當前檔案不在日記資料夾（${diaryFolder}）內。`);
    return;
  }

  const rawDoc = await app.vault.read(file);
  if (!rawDoc || rawDoc.trim().length === 0) {
    new Notice("當前日記內容為空，無法整理。");
    return;
  }

  const notice = new Notice("正在備份原稿並呼叫 AI 整理今日日記...", 0);

  try {
    // 1. Ensure .drafts folder exists and backup raw draft
    const draftsFolder = `${diaryFolder}/.drafts`;
    if (!app.vault.getAbstractFileByPath(draftsFolder)) {
      try {
        await app.vault.createFolder(draftsFolder);
      } catch {
        // Ignored if already exists
      }
    }

    const backupPath = `${draftsFolder}/${file.basename}.md`;
    const existingBackup = app.vault.getAbstractFileByPath(backupPath);
    if (existingBackup instanceof TFile) {
      await app.vault.modify(existingBackup, rawDoc);
    } else {
      await app.vault.create(backupPath, rawDoc);
    }

    // 2. Extract previously saved raw Chinese section if already tidied before
    let draftTextToProcess = rawDoc;
    const existingOriginalMatch = rawDoc.match(/## 中文原稿\s*\n([\s\S]*?)(?=\n## |$)/);
    let originalChineseDraft = rawDoc;

    if (existingOriginalMatch && existingOriginalMatch[1].trim()) {
      originalChineseDraft = existingOriginalMatch[1].trim();
      draftTextToProcess = originalChineseDraft;
    }

    // 3. Gather today's adoptions
    const todayDate = file.basename; // e.g. 2026-11-13
    const todayAdoptions = plugin.data.adoptions[todayDate] || [];
    const adoptedExpressions = todayAdoptions.map((a) => a.text);

    // 4. Call LLM
    const systemPrompt = buildTidySystemPrompt(plugin.settings.englishLevel);
    const userPrompt = buildTidyUserPrompt({
      rawContent: draftTextToProcess,
      adoptedExpressions,
      englishLevel: plugin.settings.englishLevel,
    });

    const responseText = await plugin.llm.complete({
      systemPrompt,
      userPrompt,
      temperature: 0.3,
      maxOutputTokens: 1200,
      modelOverride: plugin.settings.tidyModel || plugin.settings.model,
    });

    // Clean JSON response (strip ```json fences if model wrapped them)
    let cleanedJson = responseText.trim();
    if (cleanedJson.startsWith("```")) {
      cleanedJson = cleanedJson.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "");
    }

    const result = JSON.parse(cleanedJson);

    // 5. Match related notes in vault by topics
    const topics: string[] = Array.isArray(result.topics) ? result.topics : [];
    const relatedLinks: string[] = [];

    if (topics.length > 0) {
      const allFiles = app.vault.getMarkdownFiles().filter((f) => f.path !== file.path);
      for (const f of allFiles) {
        if (relatedLinks.length >= 3) break;
        const nameLower = f.basename.toLowerCase();
        for (const topic of topics) {
          if (topic && nameLower.includes(topic.toLowerCase())) {
            relatedLinks.push(`"[[${f.basename}]]"`);
            break;
          }
        }
      }
    }

    // 6. Format Markdown according to SPEC §5.1
    const moodList = Array.isArray(result.mood) ? result.mood.join(", ") : "reflective";
    const topicList = topics.join(", ");
    const relatedStr = relatedLinks.length > 0 ? `[${relatedLinks.join(", ")}]` : `[]`;

    let expressionsMd = "";
    if (Array.isArray(result.expressions) && result.expressions.length > 0) {
      for (const exp of result.expressions) {
        if (exp.phrase) {
          expressionsMd += `- ${exp.phrase} — ${exp.meaning || ""}\n`;
        }
      }
    } else {
      expressionsMd = "- (今日無特別記錄的新表達)\n";
    }

    const finalEnglish = (result.english || "").trim();
    const finalContent = `---
date: ${todayDate}
type: english-diary
mood: [${moodList}]
topics: [${topicList}]
level: ${plugin.settings.englishLevel}
related: ${relatedStr}
---

## English
${finalEnglish}

## 中文原稿
${originalChineseDraft.trim()}

## Today's expressions
${expressionsMd.trim()}
`;

    await app.vault.modify(file, finalContent);
    notice.hide();
    new Notice("🎉 今日日記整理完成！原稿已備份至 .drafts/。");
  } catch (err: any) {
    notice.hide();
    new Notice(`整理失敗：${err?.message || err}`);
  }
}
