export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  modelOverride?: string;
  signal?: AbortSignal;
}

export interface LLMProvider {
  stream(req: LLMRequest, onChunk: (accumulatedText: string) => void): Promise<string>;
  complete(req: LLMRequest): Promise<string>;
  testConnection(): Promise<boolean>;
}
