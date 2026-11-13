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
  const parentFolder = file.parent ? file.parent.path : "";
  const isMatchFolder =
    !parentFolder ||
    parentFolder.toLowerCase() === diaryFolder.toLowerCase() ||
    parentFolder.toLowerCase().startsWith(diaryFolder.toLowerCase() + "/");

  if (!isMatchFolder && !plugin.settings.enableInAllFolders) {
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
    const targetFolder = parentFolder || diaryFolder;

    // 1. Ensure .drafts folder exists and backup raw draft
    const draftsFolder = targetFolder ? `${targetFolder}/.drafts` : ".drafts";
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

    // 2. Extract previously saved draft sections if already tidied before
    let draftTextToProcess = rawDoc;
    let originalDraftText = rawDoc;

    const existingDraftMatch = rawDoc.match(/## (?:撰寫初稿|中文原稿)\s*\n([\s\S]*?)(?=\n## |$)/);
    if (existingDraftMatch && existingDraftMatch[1].trim()) {
      originalDraftText = existingDraftMatch[1].trim();
      draftTextToProcess = originalDraftText;
    } else {
      const existingEnglishMatch = rawDoc.match(/## English\s*\n([\s\S]*?)(?=\n## |$)/);
      if (existingEnglishMatch && existingEnglishMatch[1].trim()) {
        draftTextToProcess = existingEnglishMatch[1].trim();
      }
    }

    // 3. Gather today's adoptions and draft snippets
    const todayDate = file.basename; // e.g. 2026-11-13
    const todayAdoptions = plugin.data.adoptions[todayDate] || [];
    const adoptedExpressions = todayAdoptions.map((a) => a.text);
    const replacedDraftSnippets = todayAdoptions
      .map((a) => a.source)
      .filter((s): s is string => !!s && s.trim().length > 0);

    // 4. Call LLM
    const systemPrompt = buildTidySystemPrompt(plugin.settings.englishLevel, plugin.settings.diaryTone);
    const userPrompt = buildTidyUserPrompt({
      rawContent: draftTextToProcess,
      adoptedExpressions,
      replacedDraftSnippets,
      englishLevel: plugin.settings.englishLevel,
      diaryTone: plugin.settings.diaryTone,
    });

    const responseText = await plugin.llm.complete({
      systemPrompt,
      userPrompt,
      temperature: 0.3,
      maxOutputTokens: 1600,
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

    // 6. Format Markdown according to unified bilingual template
    const moodList = Array.isArray(result.mood) ? result.mood.join(", ") : "reflective";
    const topicList = topics.join(", ");
    const relatedStr = relatedLinks.length > 0 ? `[${relatedLinks.join(", ")}]` : `[]`;

    let expressionsMd = "";
    const expressionsList: Array<{ phrase: string; meaning: string }> = [];

    if (Array.isArray(result.expressions) && result.expressions.length > 0) {
      for (const exp of result.expressions) {
        if (exp.phrase) {
          expressionsList.push({ phrase: exp.phrase, meaning: exp.meaning || "" });
          expressionsMd += `- **${exp.phrase}** — ${exp.meaning || ""}\n`;
        }
      }
    } else {
      expressionsMd = "- (今日無特別記錄的新表達)\n";
    }

    const finalEnglish = (result.english || "").trim();
    const chineseTranslation = (result.chinese_translation || result.chinese_original || "").trim();

    // Prepare original draft content
    let draftSectionContent = originalDraftText.trim();
    if (replacedDraftSnippets.length > 0) {
      const uniqueSnippets = Array.from(new Set(replacedDraftSnippets));
      draftSectionContent += `\n\n> 💡 寫作時替換之初稿片段：${uniqueSnippets.join(" · ")}`;
    }

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

## 撰寫初稿
${draftSectionContent}

## 中文對照
${chineseTranslation}

## Today's expressions
${expressionsMd.trim()}

> 📖 查看歷史累積的全部表達：[[Expressions|📚 點此一次瀏覽全部表達庫]]
`;

    await app.vault.modify(file, finalContent);

    // 7. Update central Expressions.md hub
    await updateExpressionsHub(app, targetFolder, todayDate, expressionsList);

    notice.hide();
    new Notice("🎉 今日日記整理完成！已自動同步至 Expressions 表達庫。");
  } catch (err: any) {
    notice.hide();
    new Notice(`整理失敗：${err?.message || err}`);
  }
}

async function updateExpressionsHub(
  app: App,
  targetFolder: string,
  todayDate: string,
  expressions: Array<{ phrase: string; meaning: string }>
) {
  if (!expressions || expressions.length === 0) return;

  const hubPath = targetFolder ? `${targetFolder}/Expressions.md` : "Expressions.md";
  let expressionsLines = "";
  for (const exp of expressions) {
    if (exp.phrase) {
      expressionsLines += `- **${exp.phrase}** — ${exp.meaning || ""}\n`;
    }
  }
  if (!expressionsLines.trim()) return;

  const newSection = `## [[${todayDate}]]\n${expressionsLines.trim()}`;

  const hubFile = app.vault.getAbstractFileByPath(hubPath);
  if (hubFile instanceof TFile) {
    const existingContent = await app.vault.read(hubFile);
    // Regex for matching existing date section: e.g. "## [[2026-11-13]]" or "## 2026-11-13"
    const sectionPattern = new RegExp(`##\\s+(\\[\\[)?${todayDate}(\\]\\])?[\\s\\S]*?(?=\\n##\\s+|$)`, "i");

    if (sectionPattern.test(existingContent)) {
      const updatedContent = existingContent.replace(sectionPattern, newSection);
      await app.vault.modify(hubFile, updatedContent);
    } else {
      // Find divider "---" to insert right below header
      const dividerIndex = existingContent.indexOf("---");
      if (dividerIndex !== -1) {
        const afterDivider = dividerIndex + 3;
        const updatedContent =
          existingContent.slice(0, afterDivider) +
          `\n\n${newSection}\n` +
          existingContent.slice(afterDivider);
        await app.vault.modify(hubFile, updatedContent);
      } else {
        const updatedContent = `${existingContent.trim()}\n\n---\n\n${newSection}\n`;
        await app.vault.modify(hubFile, updatedContent);
      }
    }
  } else {
    // Create new Expressions.md
    const initialContent = `# 📚 英文日記核心表達庫 (Expressions Hub)

本筆記由「整理今日日記」自動彙總每天學到的核心表達、單字與道地片語。點擊日期標題即可跳轉至當日完整日記。

---

${newSection}
`;
    await app.vault.create(hubPath, initialContent);
  }
}
