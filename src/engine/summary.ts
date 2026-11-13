import { TFile, Vault } from "obsidian";
import { LLMProvider } from "../llm/provider";

export class SummaryManager {
  private vault: Vault;
  private llm: LLMProvider;
  private paragraphSummaries: Map<string, string> = new Map();

  constructor(vault: Vault, llm: LLMProvider) {
    this.vault = vault;
    this.llm = llm;
  }

  getParagraphSummary(filePath: string): string | undefined {
    return this.paragraphSummaries.get(filePath);
  }

  async updateParagraphSummary(filePath: string, fullDocText: string) {
    const paragraphs = fullDocText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.startsWith("---"));

    // If less than 3 paragraphs, no need to compress into a summary yet
    if (paragraphs.length < 3) {
      this.paragraphSummaries.delete(filePath);
      return;
    }

    const earlierParagraphs = paragraphs.slice(0, paragraphs.length - 1).join("\n\n");
    try {
      const summary = await this.llm.complete({
        systemPrompt: "Summarize the following diary paragraphs in 2-3 concise English sentences, capturing main events and emotions.",
        userPrompt: `<diary_text>\n${earlierParagraphs}\n</diary_text>`,
        maxOutputTokens: 100,
        temperature: 0.3,
      });
      if (summary) {
        this.paragraphSummaries.set(filePath, summary.trim());
      }
    } catch {
      // Quiet background failure
    }
  }

  async generateStyleSummary(diaryFolder: string): Promise<string> {
    const files = this.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(diaryFolder + "/"))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 5);

    if (files.length === 0) return "";

    const samples: string[] = [];
    for (const file of files) {
      const content = await this.vault.read(file);
      const englishMatch = content.match(/## English\s*\n([\s\S]*?)(?=\n## |$)/);
      if (englishMatch && englishMatch[1].trim()) {
        samples.push(englishMatch[1].trim());
      }
    }

    if (samples.length === 0) return "";

    try {
      const prompt = `Analyze these recent English diary entries and summarize the author's writing style, tone, common vocabulary tendencies, and sentence patterns in 3 concise bullet points:\n\n${samples.join("\n---\n")}`;
      const res = await this.llm.complete({
        systemPrompt: "You are a linguistic style profiler.",
        userPrompt: prompt,
        maxOutputTokens: 150,
      });
      return res.trim();
    } catch {
      return "";
    }
  }
}
