import type { LlmAdapter, LlmProtocol } from "./types.js";
import { ANTHROPIC_PROTOCOL, OLLAMA_PROTOCOL, OPENAI_PROTOCOL } from "./types.js";
import { callAnthropic } from "./anthropic.js";
import { callOllama } from "./ollama.js";
import { callOpenAI } from "./openai.js";

export const LLM_ADAPTERS: Record<LlmProtocol, LlmAdapter> = {
  [OPENAI_PROTOCOL]: {
    call: (request, context) =>
      callOpenAI(request, context.parsed, context.options, context.fetchImpl, context.timeoutMs, context.baseUrl),
  },
  [ANTHROPIC_PROTOCOL]: {
    call: (request, context) =>
      callAnthropic(request, context.parsed, context.options, context.fetchImpl, context.timeoutMs, context.baseUrl),
  },
  [OLLAMA_PROTOCOL]: {
    call: (request, context) =>
      callOllama(request, context.parsed, context.fetchImpl, context.timeoutMs, context.baseUrl),
  },
};
