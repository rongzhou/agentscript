export const OPENAI_PROTOCOL = "openai";
export const ANTHROPIC_PROTOCOL = "anthropic";
export const OLLAMA_PROTOCOL = "ollama";

export type LlmProtocol = typeof OPENAI_PROTOCOL | typeof ANTHROPIC_PROTOCOL | typeof OLLAMA_PROTOCOL;

export function isLlmProtocol(value: string): value is LlmProtocol {
  return value === OPENAI_PROTOCOL || value === ANTHROPIC_PROTOCOL || value === OLLAMA_PROTOCOL;
}

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
