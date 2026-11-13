import { requestUrl } from "obsidian";
import { LLMProvider, LLMRequest } from "./provider";

export const FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-flash-latest",
];

export class GeminiProvider implements LLMProvider {
  private apiKey: string;
  private primaryModel: string;
  private activeWorkingModel: string;

  constructor(apiKey: string, primaryModel: string) {
    this.apiKey = apiKey;
    this.primaryModel = primaryModel || "gemini-3.5-flash-lite";
    this.activeWorkingModel = this.primaryModel;
  }

  updateConfig(apiKey: string, primaryModel: string) {
    this.apiKey = apiKey;
    this.primaryModel = primaryModel || "gemini-3.5-flash-lite";
    this.activeWorkingModel = this.primaryModel;
  }

  getActiveModel(): string {
    return this.activeWorkingModel;
  }

  async testConnection(): Promise<boolean> {
    if (!this.apiKey) return false;

    const modelsToTry = [
      this.activeWorkingModel,
      ...FALLBACK_MODELS.filter((m) => m !== this.activeWorkingModel),
    ];

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
        const resp = await requestUrl({
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "ping" }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
        });

        if (resp.status === 200) {
          this.activeWorkingModel = model;
          return true;
        }
      } catch (e: any) {
        // Continue to try fallback model
      }
    }

    return false;
  }

  private buildPayload(req: LLMRequest) {
    const generationConfig: Record<string, any> = {
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxOutputTokens ?? 200,
      responseMimeType: "application/json",
    };

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
        const result = await this.streamWithModel(currentModel, req, onChunk);
        this.activeWorkingModel = currentModel;
        return result;
      } catch (err: any) {
        lastError = err;
        if (req.signal?.aborted) {
          throw err;
        }

        // If 404 or deprecated model, try next fallback
        if (err.message && (err.message.includes("404") || err.message.includes("not found") || err.message.includes("no longer available"))) {
          continue;
        }

        // Try non-streaming requestUrl fallback
        try {
          const nonStreamResult = await this.completeWithModel(currentModel, req);
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
    onChunk: (accumulatedText: string) => void
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;
    const payload = this.buildPayload(req);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
            // Partial JSON chunk
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
        const res = await this.completeWithModel(currentModel, req);
        this.activeWorkingModel = currentModel;
        return res;
      } catch (err: any) {
        lastError = err;
        if (err.message && (err.message.includes("404") || err.message.includes("not found") || err.message.includes("no longer available"))) {
          continue;
        }
      }
    }

    throw lastError || new Error("Failed to complete request with Gemini API.");
  }

  private async completeWithModel(
    model: string,
    req: LLMRequest
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const payload = this.buildPayload(req);

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
