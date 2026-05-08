import type { GenerateRequest, JsonObject, RuntimeValue } from "../../runtime/types.js";
import { budgetToTokenLimit, parseJsonText, postJson, readPath } from "./shared.js";
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
    think: false,
    format: request.builtContext.returnSchema,
    messages: [
      { role: "system", content: request.builtContext.system },
      { role: "user", content: request.builtContext.finalUserMessage },
    ],
  };
  const maxTokens = budgetToTokenLimit(request);
  if (maxTokens) {
    body.options = { num_predict: maxTokens };
  }

  const response = await postJson(fetchImpl, `${baseUrl}/api/chat`, body, timeoutMs);
  return parseJsonText(readPath(response, ["message", "content"]));
}
