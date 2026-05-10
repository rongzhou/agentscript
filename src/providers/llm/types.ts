export type LlmProtocol = "openai" | "anthropic" | "ollama";

export const SUPPORTED_LLM_PROTOCOLS: ReadonlySet<LlmProtocol> = new Set(["openai", "anthropic", "ollama"]);

export interface ParsedLlmUri {
  protocol: LlmProtocol;
  model: string;
  baseUrl?: string;
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface ProtocolLlmProviderOptions {
  fetch?: FetchLike;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  ollamaBaseUrl?: string;
  timeoutMs?: number;
}
