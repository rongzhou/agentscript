import { RuntimeError } from "../../runtime/errors.js";
import type { GenerateRequest, JsonObject, RuntimeValue } from "../../runtime/types.js";
import { budgetToTokenLimit, finalizeLlmResponse, postJson, readPath } from "./shared.js";
import type { FetchLike, ParsedLlmUri } from "./types.js";

export async function callOllama(
  request: GenerateRequest,
  parsed: ParsedLlmUri,
  fetchImpl: FetchLike,
  timeoutMs: number,
  baseUrl: string,
): Promise<RuntimeValue> {
  const body: JsonObject = {
    model: parsed.model,
    stream: false,
    think: request.think ?? false,
    messages: [
      { role: "system", content: request.builtContext.system },
      { role: "user", content: request.builtContext.finalUserMessage },
    ],
  };
  if (request.builtContext.returnSchema) {
    body.format = request.builtContext.returnSchema;
  }
  const maxTokens = budgetToTokenLimit(request);
  const options: JsonObject = {};
  if (maxTokens) {
    options.num_predict = maxTokens;
  }
  if (request.temperature !== undefined) {
    options.temperature = request.temperature;
  }
  if (Object.keys(options).length > 0) {
    body.options = options;
  }

  const response = await postJson(fetchImpl, `${baseUrl}/api/chat`, body, timeoutMs);
  const text = readPath(response, ["message", "content"]);
  if (text.length === 0 && hasOllamaThinking(response)) {
    throw new RuntimeError(
      "Ollama returned thinking output but no final content. Increase generate max_output or disable think.",
    );
  }
  return finalizeLlmResponse(text, request);
}

function hasOllamaThinking(response: unknown): boolean {
  if (typeof response !== "object" || response === null || !("message" in response)) {
    return false;
  }
  const message = (response as { message?: unknown }).message;
  return (
    typeof message === "object" && message !== null && typeof (message as { thinking?: unknown }).thinking === "string"
  );
}
