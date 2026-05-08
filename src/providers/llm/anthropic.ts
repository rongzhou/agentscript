import { RuntimeError } from "../../runtime/errors.js";
import type { GenerateRequest, JsonValue, RuntimeValue } from "../../runtime/types.js";
import { budgetToTokenLimit, parseJsonText, postJson } from "./shared.js";
import type { FetchLike, ParsedLlmUri, ProtocolLlmProviderOptions } from "./types.js";

export async function callAnthropic(
  request: GenerateRequest,
  parsed: ParsedLlmUri,
  options: ProtocolLlmProviderOptions,
  fetchImpl: FetchLike,
  timeoutMs: number,
  baseUrl: string,
): Promise<RuntimeValue> {
  const apiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new RuntimeError("ANTHROPIC_API_KEY is required for anthropic:// models");
  }

  const response = await postJson(fetchImpl, `${baseUrl}/messages`, {
    model: parsed.model,
    max_tokens: budgetToTokenLimit(request) ?? 1024,
    system: request.builtContext.system,
    messages: [
      {
        role: "user",
        content: request.builtContext.finalUserMessage,
      },
    ],
  }, timeoutMs, {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  });
  const text = readAnthropicText(response);
  return request.returnShape ? parseJsonText(text) : text;
}

function readAnthropicText(value: JsonValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.content)) {
    throw new RuntimeError("Anthropic response is missing content");
  }
  return value.content.filter(isAnthropicTextBlock).map((block) => block.text).join("");
}

function isAnthropicTextBlock(block: JsonValue): block is { type: "text"; text: string } {
  return (
    block != null &&
    typeof block === "object" &&
    !Array.isArray(block) &&
    block.type === "text" &&
    typeof block.text === "string"
  );
}
