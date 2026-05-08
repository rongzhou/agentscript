import { RuntimeError } from "../../runtime/errors.js";
import type { GenerateRequest, LlmProvider, RuntimeValue } from "../../runtime/types.js";
import { callAnthropic } from "./anthropic.js";
import { callOllama } from "./ollama.js";
import { callOpenAI } from "./openai.js";
import { trimTrailingSlash } from "./shared.js";
import type { FetchLike, ParsedLlmUri, ProtocolLlmProviderOptions } from "./types.js";
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
    switch (parsed.protocol) {
      case "openai":
        return callOpenAI(request, parsed, this.options, this.fetchImpl, timeoutMs, this.openAIBaseUrl(parsed));
      case "anthropic":
        return callAnthropic(request, parsed, this.options, this.fetchImpl, timeoutMs, this.anthropicBaseUrl(parsed));
      case "ollama":
        return callOllama(request, parsed, this.fetchImpl, timeoutMs, this.ollamaBaseUrl(parsed));
    }
  }

  private requestTimeoutMs(): number {
    const value = this.options.timeoutMs ?? Number.parseInt(process.env.AGENTSCRIPT_LLM_TIMEOUT_MS ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : 30_000;
  }

  private openAIBaseUrl(parsed: ParsedLlmUri): string {
    return this.providerBaseUrl(parsed, this.options.openaiBaseUrl, "OPENAI_BASE_URL", "https://api.openai.com/v1");
  }

  private anthropicBaseUrl(parsed: ParsedLlmUri): string {
    return this.providerBaseUrl(
      parsed,
      this.options.anthropicBaseUrl,
      "ANTHROPIC_BASE_URL",
      "https://api.anthropic.com/v1",
    );
  }

  private ollamaBaseUrl(parsed: ParsedLlmUri): string {
    return this.providerBaseUrl(parsed, this.options.ollamaBaseUrl, "OLLAMA_BASE_URL", "http://localhost:11434");
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
