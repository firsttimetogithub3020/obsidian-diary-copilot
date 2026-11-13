import { requestUrl } from "obsidian";
import { LLMProvider, LLMRequest } from "./provider";

const FALLBACK_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-1.5-flash"
];

export class GeminiProvider implements LLMProvider {
  private apiKey: string;
  private primaryModel: string;
  private activeWorkingModel: string;

  constructor(apiKey: string, primaryModel: string) {
    this.apiKey = apiKey;
    this.primaryModel = primaryModel || "gemini-2.5-flash-lite";
    this.activeWorkingModel = this.primaryModel;
  }

  updateConfig(apiKey: string, primaryModel: string) {
    this.apiKey = apiKey;
    this.primaryModel = primaryModel || "gemini-2.5-flash-lite";
    this.activeWorkingModel = this.primaryModel;
  }

  getActiveModel(): string {
    return this.activeWorkingModel;
  }

  async testConnection(): Promise<boolean> {
    if (!this.apiKey) return false;
    const model = this.activeWorkingModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    try {
      const resp = await requestUrl({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      });
      return resp.status === 200;
    } catch (e: any) {
      // If 404, try fallbacks
      for (const fallback of FALLBACK_MODELS) {
        if (fallback === model) continue;
        try {
          const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(fallback)}:generateContent`;
          const resp = await requestUrl({
            url: fallbackUrl,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "ping" }] }],
              generationConfig: { maxOutputTokens: 5 },
            }),
          });
          if (resp.status === 200) {
            this.activeWorkingModel = fallback;
            return true;
          }
        } catch {
          // continue checking
        }
      }
      return false;
    }
  }

  private buildPayload(req: LLMRequest, includeThinking: boolean) {
    const generationConfig: Record<string, any> = {
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxOutputTokens ?? 200,
      responseMimeType: "application/json",
    };

    if (includeThinking) {
      generationConfig.thinkingConfig = {
        thinkingBudget: 0,
      };
    }

    return {
      contents: [
        {
          role: "user",
          parts: [{ text: req.userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: req.systemPrompt }],
      },
      generationConfig,
    };
  }

  async stream(req: LLMRequest, onChunk: (accumulatedText: string) => void): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const modelsToTry = [
      req.modelOverride || this.activeWorkingModel,
      ...FALLBACK_MODELS.filter((m) => m !== (req.modelOverride || this.activeWorkingModel)),
    ];

    let lastError: any = null;

    for (const currentModel of modelsToTry) {
      try {
        const result = await this.streamWithModel(currentModel, req, onChunk, true);
        this.activeWorkingModel = currentModel;
        return result;
      } catch (err: any) {
        lastError = err;
        // If aborted by user, don't try fallback models
        if (req.signal?.aborted) {
          throw err;
        }

        // If error might be due to thinkingConfig not supported, retry without thinkingConfig
        if (err.message && (err.message.includes("thinking") || err.message.includes("400"))) {
          try {
            const result = await this.streamWithModel(currentModel, req, onChunk, false);
            this.activeWorkingModel = currentModel;
            return result;
          } catch (retryErr: any) {
            lastError = retryErr;
          }
        }

        // If error is 404 (model not found), proceed to next fallback model
        if (err.message && (err.message.includes("404") || err.message.includes("not found"))) {
          continue;
        }

        // For other network/CORS issues, attempt fallback to complete() via Obsidian requestUrl
        try {
          const nonStreamResult = await this.completeWithModel(currentModel, req, false);
          onChunk(nonStreamResult);
          this.activeWorkingModel = currentModel;
          return nonStreamResult;
        } catch (completeErr) {
          lastError = completeErr;
        }
      }
    }

    throw lastError || new Error("Failed to get suggestion from Gemini API.");
  }

  private async streamWithModel(
    model: string,
    req: LLMRequest,
    onChunk: (accumulatedText: string) => void,
    includeThinking: boolean
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const payload = this.buildPayload(req, includeThinking);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Gemini API HTTP ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error("No response body received from Gemini stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let accumulatedText = "";

    try {
      while (true) {
        if (req.signal?.aborted) {
          await reader.cancel();
          throw new DOMException("Aborted", "AbortError");
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);
            const candidates = data.candidates;
            if (candidates && candidates.length > 0) {
              const parts = candidates[0].content?.parts;
              if (parts && parts.length > 0) {
                for (const part of parts) {
                  if (part.text) {
                    accumulatedText += part.text;
                    onChunk(accumulatedText);
                  }
                }
              }
            }
          } catch {
            // Partial JSON in SSE chunk, ignore parse error until full JSON line arrives
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return accumulatedText;
  }

  async complete(req: LLMRequest): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const modelsToTry = [
      req.modelOverride || this.activeWorkingModel,
      ...FALLBACK_MODELS.filter((m) => m !== (req.modelOverride || this.activeWorkingModel)),
    ];

    let lastError: any = null;
    for (const currentModel of modelsToTry) {
      try {
        const res = await this.completeWithModel(currentModel, req, false);
        this.activeWorkingModel = currentModel;
        return res;
      } catch (err: any) {
        lastError = err;
        if (err.message && (err.message.includes("404") || err.message.includes("not found"))) {
          continue;
        }
      }
    }

    throw lastError || new Error("Failed to complete request with Gemini API.");
  }

  private async completeWithModel(
    model: string,
    req: LLMRequest,
    includeThinking: boolean
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const payload = this.buildPayload(req, includeThinking);

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (resp.status !== 200) {
      throw new Error(`Gemini API error ${resp.status}: ${resp.text}`);
    }

    const data = resp.json;
    const candidates = data.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content?.parts;
      if (parts && parts.length > 0) {
        return parts.map((p: any) => p.text || "").join("");
      }
    }

    return "";
  }
}
