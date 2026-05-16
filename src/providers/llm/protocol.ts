import { RuntimeError } from "../../runtime/core/errors.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { GenerateRequest, LlmProvider } from "../../runtime/values/providers.js";
import { callAnthropic } from "./anthropic.js";
import { callOllama } from "./ollama.js";
import { callOpenAI } from "./openai.js";
import { trimTrailingSlash } from "./shared.js";
import {
  ANTHROPIC_PROTOCOL,
  OLLAMA_PROTOCOL,
  OPENAI_PROTOCOL,
  type FetchLike,
  type ParsedLlmUri,
  type ProtocolLlmProviderOptions,
} from "./types.js";
import { parseLlmUri } from "./uri.js";

export class ProtocolLlmProvider implements LlmProvider {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: ProtocolLlmProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async generate(request: GenerateRequest): Promise<RuntimeValue> {
    if (!request.model) {
      throw new RuntimeError("A real LLM provider requires an agent model declaration");
    }

    const parsed = parseLlmUri(request.model);
    const timeoutMs = this.requestTimeoutMs();
    const baseUrl = this.baseUrl(parsed);
    switch (parsed.protocol) {
      case OPENAI_PROTOCOL:
        return callOpenAI(request, parsed, this.options, this.fetchImpl, timeoutMs, baseUrl);
      case ANTHROPIC_PROTOCOL:
        return callAnthropic(request, parsed, this.options, this.fetchImpl, timeoutMs, baseUrl);
      case OLLAMA_PROTOCOL:
        return callOllama(request, parsed, this.fetchImpl, timeoutMs, baseUrl);
    }
  }

  private requestTimeoutMs(): number {
    const value = this.options.timeoutMs ?? Number.parseInt(process.env.AGENTSCRIPT_LLM_TIMEOUT_MS ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : 30_000;
  }

  private baseUrl(parsed: ParsedLlmUri): string {
    switch (parsed.protocol) {
      case OPENAI_PROTOCOL:
        return this.providerBaseUrl(parsed, this.options.openaiBaseUrl, "OPENAI_BASE_URL", "https://api.openai.com/v1");
      case ANTHROPIC_PROTOCOL:
        return this.providerBaseUrl(
          parsed,
          this.options.anthropicBaseUrl,
          "ANTHROPIC_BASE_URL",
          "https://api.anthropic.com/v1",
        );
      case OLLAMA_PROTOCOL:
        return this.providerBaseUrl(parsed, this.options.ollamaBaseUrl, "OLLAMA_BASE_URL", "http://localhost:11434");
    }
  }

  private providerBaseUrl(
    parsed: ParsedLlmUri,
    configuredUrl: string | undefined,
    environmentName: string,
    fallback: string,
  ): string {
    return trimTrailingSlash(parsed.baseUrl ?? configuredUrl ?? process.env[environmentName] ?? fallback);
  }
}
