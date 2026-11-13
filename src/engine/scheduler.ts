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
  onShadowComplete?: (completedText: string) => void;
  onShadowAbandon?: () => void;
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
  private isShadowTypingMode = false;

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

  startShadowTyping(targetText: string, anchorPosition: number) {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    this.isShadowTypingMode = true;
    this.originalContinueText = targetText.trim();
    this.anchorPos = anchorPosition;

    const shadowItem: SuggestionItem = {
      card1: this.originalContinueText,
      card2: "",
      card3: "",
      card4: "",
      continueText: this.originalContinueText,
      alternativeText: "",
    };

    this.lastActiveSuggestion = shadowItem;
    this.callbacks.onSuggestion(shadowItem, false);
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
    this.isShadowTypingMode = false;
    this.lastContextHash = "";
  }

  refetch(context: ExtractedContext, styleSummary?: string, paragraphSummary?: string) {
    this.lastContextHash = "";
    this.triggerFetch(context, styleSummary, paragraphSummary);
  }

  handleDocChange(
    context: ExtractedContext,
    styleSummary?: string,
    paragraphSummary?: string
  ) {
    const settings = this.getSettings();

    // 1. Deliberate Shadow-Typing Mode (user explicitly selected a card)
    if (this.isShadowTypingMode) {
      // If cursor moved before the anchor position (user deleted past beginning)
      if (context.cursorOffset < this.anchorPos) {
        this.clear();
        this.callbacks.onShadowAbandon?.();
        // Fall through to normal suggestion flow
      } else {
        const typedDiff = context.fullDocText.slice(this.anchorPos, context.cursorOffset);

        // Trigger 2: User pressed Enter (newline) -> Abandon shadow-typing!
        if (typedDiff.includes("\n")) {
          this.clear();
          this.callbacks.onShadowAbandon?.();
          this.callbacks.onLoading();
          // Instant 0ms trigger for new line: do not wait for debounce!
          this.triggerFetch(context, styleSummary, paragraphSummary);
          return;
        } else {
          const match = tryMatchPrefix(typedDiff, this.originalContinueText);

          if (match.matched) {
            if (match.remainingContinueText.length > 0) {
              // Actively matching! Ghost text is rendered in CodeMirror state field synchronously.
              return;
            } else {
              // Trigger 1: Completed typing the entire target sentence!
              const completedText = this.originalContinueText;
              this.clear();
              this.callbacks.onShadowComplete?.(completedText);

              // Instant 0ms trigger for next sentence: do not wait for debounce!
              this.callbacks.onLoading();
              this.triggerFetch(context, styleSummary, paragraphSummary);
              return;
            }
          } else {
            // Mismatched / Typo!
            // CRITICAL: Stay locked in shadow-typing mode!
            // Do NOT overwrite lastActiveSuggestion!
            // Do NOT trigger Gemini fetch!
            // Do NOT call onLoading!
            // The user can press Backspace to fix typo and ghost text will resume!
            return;
          }
        }
      }
    }

    // 2. Normal Suggestion Mode (free writing)
    if (
      this.lastActiveSuggestion &&
      this.originalContinueText &&
      context.cursorOffset >= this.anchorPos
    ) {
      const typedDiff = context.fullDocText.slice(this.anchorPos, context.cursorOffset);
      const match = tryMatchPrefix(typedDiff, this.originalContinueText);

      if (match.matched) {
        if (match.remainingContinueText.length > 0) {
          // Free writing matches Card 1; ghost text advances
          return;
        } else {
          // Finished typing Card 1
          this.clear();
          this.callbacks.onLoading();
          this.triggerFetch(context, styleSummary, paragraphSummary);
          return;
        }
      }
    }

    // Reset prefix tracking when not matched in free writing mode
    this.originalContinueText = "";
    this.anchorPos = context.cursorOffset;
    this.isShadowTypingMode = false;

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
      ? (settings.debounceMs || 180)
      : (settings.noPunctuationDebounceMs || 350);

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

    if (
      context.currentSentence.trim().length === 0 &&
      (!context.chineseSegment || context.chineseSegment.trim().length === 0)
    ) {
      this.callbacks.onError();
      return;
    }

    const contextHash = `${context.currentSentence}__${context.chineseSegment || ""}`;
    if (contextHash === this.lastContextHash && this.lastActiveSuggestion) {
      this.callbacks.onSuggestion(this.lastActiveSuggestion, false);
      return;
    }

    const requestId = ++this.currentRequestId;
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const systemPrompt = buildSuggestionSystemPrompt(settings.englishLevel, settings.diaryTone, styleSummary);
    const userPrompt = buildSuggestionUserPrompt({
      englishLevel: settings.englishLevel,
      tone: settings.diaryTone,
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
          maxOutputTokens: 250,
          signal: abortController.signal,
        },
        (chunkText) => {
          if (requestId !== this.currentRequestId) return;

          const parsed = parsePartialSuggestion(chunkText);
          if (parsed && (parsed.card1 || parsed.card2 || parsed.card3 || parsed.card4)) {
            if (hasChinese && context.chineseRange) {
              parsed.sourceRange = context.chineseRange;
              parsed.translationSource = context.chineseSegment;
            }

            latestSuggestion = parsed;
            this.lastActiveSuggestion = parsed;
            this.callbacks.onSuggestion(parsed, true);
          }
        }
      );

      if (requestId === this.currentRequestId && latestSuggestion) {
        this.lastContextHash = contextHash;
        this.lastActiveSuggestion = latestSuggestion;

        if (hasChinese && context.chineseRange) {
          (latestSuggestion as SuggestionItem).sourceRange = context.chineseRange;
          (latestSuggestion as SuggestionItem).translationSource = context.chineseSegment;
        }

        this.originalContinueText = (latestSuggestion as SuggestionItem).card1 || (latestSuggestion as SuggestionItem).continueText;
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
