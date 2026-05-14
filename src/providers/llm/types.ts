import type { GenerateRequest, RuntimeValue } from "../../runtime/types.js";

export const OPENAI_PROTOCOL = "openai";
export const ANTHROPIC_PROTOCOL = "anthropic";
export const OLLAMA_PROTOCOL = "ollama";

const SUPPORTED_LLM_PROTOCOLS = [OPENAI_PROTOCOL, ANTHROPIC_PROTOCOL, OLLAMA_PROTOCOL] as const;

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

export interface LlmAdapter {
  call(request: GenerateRequest, context: LlmAdapterContext): Promise<RuntimeValue>;
}

interface LlmAdapterContext {
  parsed: ParsedLlmUri;
  fetchImpl: FetchLike;
  options: ProtocolLlmProviderOptions;
  timeoutMs: number;
  baseUrl: string;
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
