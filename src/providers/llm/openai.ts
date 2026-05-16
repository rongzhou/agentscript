import type { JsonObject, RuntimeValue } from "../../runtime/values/values.js";
import type { GenerateRequest } from "../../runtime/values/providers.js";
import { budgetToTokenLimit, finalizeLlmResponse, postJson, readPath, requireApiKey } from "./shared.js";
import type { FetchLike, ParsedLlmUri, ProtocolLlmProviderOptions } from "./types.js";

export async function callOpenAI(
  request: GenerateRequest,
  parsed: ParsedLlmUri,
  options: ProtocolLlmProviderOptions,
  fetchImpl: FetchLike,
  timeoutMs: number,
  baseUrl: string,
): Promise<RuntimeValue> {
  const apiKey = requireApiKey(options.openaiApiKey, "OPENAI_API_KEY", "openai");

  const body: JsonObject = {
    model: parsed.model,
    messages: [
      { role: "system", content: request.builtContext.system },
      { role: "user", content: request.builtContext.finalUserMessage },
    ],
  };
  if (request.builtContext.returnSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "agentscript_generate",
        strict: request.strict,
        schema: request.builtContext.returnSchema,
      },
    };
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  const reasoningEffort = openAIReasoningEffort(request.think);
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }
  const maxTokens = budgetToTokenLimit(request);
  if (maxTokens) {
    body.max_completion_tokens = maxTokens;
  }

  const response = await postJson(fetchImpl, `${baseUrl}/chat/completions`, body, timeoutMs, {
    authorization: `Bearer ${apiKey}`,
  });
  const text = readPath(response, ["choices", 0, "message", "content"]);
  return finalizeLlmResponse(text, request);
}

function openAIReasoningEffort(think: boolean | string | undefined): string | undefined {
  if (think === true) return "medium";
  if (think === "low" || think === "medium" || think === "high") return think;
  return undefined;
}
