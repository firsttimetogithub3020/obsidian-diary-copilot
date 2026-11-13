import { App, TFile, Notice } from "obsidian";
import type DiaryCopilotPlugin from "../main";

export async function openTodayDiary(app: App, plugin: DiaryCopilotPlugin) {
  const folder = plugin.settings.diaryFolder || "Diary";
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayStr = `${year}-${month}-${day}`;
  const filePath = `${folder}/${todayStr}.md`;

  // Ensure diary folder exists
  const folderExists = app.vault.getAbstractFileByPath(folder);
  if (!folderExists) {
    try {
      await app.vault.createFolder(folder);
    } catch {
      // folder might already exist
    }
  }

  let file = app.vault.getAbstractFileByPath(filePath);
  if (!file) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const createdStr = `${todayStr} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const initialContent = `---
title: ${todayStr}
date: ${todayStr}
created: ${createdStr}
type: english-diary
---

# ${todayStr}

`;
    file = await app.vault.create(filePath, initialContent);
    new Notice(`已建立今日日記：${filePath}`);
  }

  if (file instanceof TFile) {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }
}
