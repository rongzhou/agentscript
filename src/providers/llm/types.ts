export const SUPPORTED_LLM_PROTOCOLS = ["openai", "anthropic", "ollama"] as const;

export type LlmProtocol = (typeof SUPPORTED_LLM_PROTOCOLS)[number];

export const SUPPORTED_LLM_PROTOCOL_SET: ReadonlySet<LlmProtocol> = new Set(SUPPORTED_LLM_PROTOCOLS);

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
