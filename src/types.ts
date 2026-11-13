export type EnglishLevel = "beginner" | "intermediate" | "upper-intermediate" | "advanced";

export type DiaryTone =
  | "casual"
  | "reflective"
  | "motivational"
  | "vivid"
  | "humorous"
  | "social-science"
  | "sinology";

export interface PluginSettings {
  geminiApiKey: string;
  model: string;
  tidyModel: string;
  diaryFolder: string;
  enableInAllFolders: boolean;
  englishLevel: EnglishLevel;
  diaryTone: DiaryTone;
  debounceMs: number;
  noPunctuationDebounceMs: number;
  guidanceDelaySec: number;
  showGhostText: boolean;
  dailyRequestLimit: number;
  cardFontSize: number;
  panelMinHeight: number;
}

export interface SuggestionItem {
  card1: string;
  card2: string;
  card3: string;
  card4: string;
  // Aliases for compatibility
  continueText: string;
  alternativeText: string;
  translationText?: string | null;
  translationSource?: string | null;
  sourceRange?: { from: number; to: number };
}

export interface AdoptionRecord {
  text: string;
  kind: "continue" | "alternative" | "translation";
  source?: string;
  timestamp: number;
}

export interface DayUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface PluginData {
  settings: PluginSettings;
  adoptions: Record<string, AdoptionRecord[]>; // Keyed by YYYY-MM-DD
  styleSummary: {
    summary: string;
    lastUpdated: string; // YYYY-MM-DD
  };
  usage: Record<string, DayUsage>; // Keyed by YYYY-MM-DD
}
