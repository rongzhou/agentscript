import { RuntimeError } from "../../runtime/errors.js";
import type { GenerateRequest, JsonObject, JsonValue, RuntimeValue } from "../../runtime/types.js";
import { budgetToTokenLimit, finalizeLlmResponse, postJson, requireApiKey } from "./shared.js";
import type { FetchLike, ParsedLlmUri, ProtocolLlmProviderOptions } from "./types.js";

export async function callAnthropic(
  request: GenerateRequest,
  parsed: ParsedLlmUri,
  options: ProtocolLlmProviderOptions,
  fetchImpl: FetchLike,
  timeoutMs: number,
  baseUrl: string,
): Promise<RuntimeValue> {
  const apiKey = requireApiKey(options.anthropicApiKey, "ANTHROPIC_API_KEY", "anthropic");
  const finalTokenLimit = budgetToTokenLimit(request) ?? 1024;
  const thinkingBudget = anthropicThinkingBudget(request.think);
  if (thinkingBudget !== undefined && request.temperature !== undefined) {
    throw new RuntimeError("Anthropic extended thinking is not compatible with generate temperature");
  }

  const body: JsonObject = {
    model: parsed.model,
    max_tokens: finalTokenLimit + (thinkingBudget ?? 0),
    system: request.builtContext.system,
    messages: [
      {
        role: "user",
        content: request.builtContext.finalUserMessage,
      },
    ],
  };
  if (thinkingBudget !== undefined) {
    body.thinking = {
      type: "enabled",
      budget_tokens: thinkingBudget,
    };
  } else if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  const response = await postJson(fetchImpl, `${baseUrl}/messages`, body, timeoutMs, {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  });
  const text = readAnthropicText(response);
  return finalizeLlmResponse(text, request);
}

function anthropicThinkingBudget(think: boolean | string | undefined): number | undefined {
  switch (think) {
    case true:
    case "auto":
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 10000;
    case false:
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

function readAnthropicText(value: JsonValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.content)) {
    throw new RuntimeError("Anthropic response is missing content");
  }
  return value.content
    .filter(isAnthropicTextBlock)
    .map((block) => block.text)
    .join("");
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
