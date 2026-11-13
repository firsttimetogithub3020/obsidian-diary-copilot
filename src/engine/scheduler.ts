import { ExtractedContext } from "./context";
import { parsePartialSuggestion } from "./parser";
import { tryMatchPrefix } from "./prefixMatch";
import { LLMProvider } from "../llm/provider";
import {
  buildSuggestionSystemPrompt,
  buildSuggestionUserPrompt,
} from "../llm/prompts";
import { SuggestionItem, PluginSettings } from "../types";

export interface SchedulerCallbacks {
  onLoading: () => void;
  onSuggestion: (item: SuggestionItem, isStreaming: boolean) => void;
  onError: () => void;
  onUsageIncrement?: (inputTokens: number, outputTokens: number) => void;
}

const PUNCTUATION_OR_SPACE_REGEX = /[,.?!;:，。？！、\s]$/;

export class SuggestionScheduler {
  private llm: LLMProvider;
  private getSettings: () => PluginSettings;
  private callbacks: SchedulerCallbacks;

  private timer: number | null = null;
  private currentRequestId = 0;
  private activeAbortController: AbortController | null = null;

  // Cache & Prefix Matching (Shadow Typing) state
  private lastContextHash = "";
  private lastActiveSuggestion: SuggestionItem | null = null;
  private originalContinueText = "";
  private anchorPos = 0;

  constructor(
    llm: LLMProvider,
    getSettings: () => PluginSettings,
    callbacks: SchedulerCallbacks
  ) {
    this.llm = llm;
    this.getSettings = getSettings;
    this.callbacks = callbacks;
  }

  getCurrentSuggestion(): SuggestionItem | null {
    return this.lastActiveSuggestion;
  }

  clear() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.lastActiveSuggestion = null;
    this.originalContinueText = "";
    this.anchorPos = 0;
  }

  handleDocChange(
    context: ExtractedContext,
    styleSummary?: string,
    paragraphSummary?: string
  ) {
    const settings = this.getSettings();

    // Check if doc change can be satisfied by local shadow typing (prefix matching)
    // Only in pure English mode (not while Chinese translation is waiting for Tab)
    if (
      this.lastActiveSuggestion &&
      this.originalContinueText &&
      !context.chineseSegment &&
      context.cursorOffset >= this.anchorPos
    ) {
      const typedDiff = context.fullDocText.slice(this.anchorPos, context.cursorOffset);
      const match = tryMatchPrefix(typedDiff, this.originalContinueText);

      if (match.matched) {
        if (match.remainingContinueText.length > 0) {
          const updatedSuggestion: SuggestionItem = {
            ...this.lastActiveSuggestion,
            continueText: match.remainingContinueText,
          };
          this.lastActiveSuggestion = updatedSuggestion;
          this.callbacks.onSuggestion(updatedSuggestion, false);
          return;
        }
      }
    }

    // Reset prefix tracking when not matched or typing new thought
    this.originalContinueText = "";
    this.anchorPos = context.cursorOffset;

    // Clear previous timer & cancel active request
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    // Determine debounce delay
    const hasPunctuationOrSpace = PUNCTUATION_OR_SPACE_REGEX.test(context.currentSentence);
    const delay = hasPunctuationOrSpace
      ? settings.debounceMs
      : settings.noPunctuationDebounceMs;

    this.callbacks.onLoading();

    this.timer = window.setTimeout(() => {
      this.triggerFetch(context, styleSummary, paragraphSummary);
    }, delay);
  }

  private async triggerFetch(
    context: ExtractedContext,
    styleSummary?: string,
    paragraphSummary?: string
  ) {
    const settings = this.getSettings();
    if (!settings.geminiApiKey) {
      this.callbacks.onError();
      return;
    }

    // Check if sentence is practically empty
    if (
      context.currentSentence.trim().length === 0 &&
      (!context.chineseSegment || context.chineseSegment.trim().length === 0)
    ) {
      this.callbacks.onError();
      return;
    }

    // Context deduplication hash
    const contextHash = `${context.currentSentence}__${context.chineseSegment || ""}`;
    if (contextHash === this.lastContextHash && this.lastActiveSuggestion) {
      this.callbacks.onSuggestion(this.lastActiveSuggestion, false);
      return;
    }

    const requestId = ++this.currentRequestId;
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const systemPrompt = buildSuggestionSystemPrompt(settings.englishLevel, styleSummary);
    const userPrompt = buildSuggestionUserPrompt({
      englishLevel: settings.englishLevel,
      styleSummary,
      paragraphSummary,
      recentSentences: context.recentSentences,
      currentSentence: context.currentSentence,
      chineseSegment: context.chineseSegment,
    });

    try {
      let latestSuggestion: SuggestionItem | null = null;
      const hasChinese = !!(context.chineseSegment && context.chineseSegment.trim().length > 0);

      await this.llm.stream(
        {
          systemPrompt,
          userPrompt,
          temperature: 0.7,
          maxOutputTokens: 160,
          signal: abortController.signal,
        },
        (chunkText) => {
          if (requestId !== this.currentRequestId) return;

          const parsed = parsePartialSuggestion(chunkText);
          if (parsed && (parsed.continueText || parsed.alternativeText || parsed.translationText)) {
            if (context.chineseRange) {
              parsed.sourceRange = context.chineseRange;
              parsed.translationSource = context.chineseSegment;
            }

            // Option 1: When Chinese is present, promote translation to Card 1 for instant Tab replacement!
            if (hasChinese && parsed.translationText) {
              parsed.continueText = parsed.translationText;
            }

            latestSuggestion = parsed;
            this.callbacks.onSuggestion(parsed, true);
          }
        }
      );

      if (requestId === this.currentRequestId && latestSuggestion) {
        this.lastContextHash = contextHash;
        this.lastActiveSuggestion = latestSuggestion;

        if (hasChinese && (latestSuggestion as SuggestionItem).translationText) {
          (latestSuggestion as SuggestionItem).continueText = (latestSuggestion as SuggestionItem).translationText!;
          (latestSuggestion as SuggestionItem).sourceRange = context.chineseRange;
          (latestSuggestion as SuggestionItem).translationSource = context.chineseSegment;
        }

        this.originalContinueText = (latestSuggestion as SuggestionItem).continueText;
        this.anchorPos = context.cursorOffset;
        this.callbacks.onSuggestion(latestSuggestion, false);
      }
    } catch (e: any) {
      if (abortController.signal.aborted) {
        return;
      }
      this.callbacks.onError();
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }
}
