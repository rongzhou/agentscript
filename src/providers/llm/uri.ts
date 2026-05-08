import { RuntimeError } from "../../runtime/errors.js";
import type { LlmBinding } from "../../runtime/types.js";
import type { LlmProtocol, ParsedLlmUri } from "./types.js";

const SUPPORTED_LLM_PROTOCOLS = new Set(["openai:", "anthropic:", "ollama:"]);

export function parseLlmUri(model: LlmBinding): ParsedLlmUri {
  if (!model.uri.includes("://")) {
    throw new RuntimeError("LLM URI must use an explicit protocol URL form");
  }
  const url = new URL(model.uri);
  if (!SUPPORTED_LLM_PROTOCOLS.has(url.protocol)) {
    throw new RuntimeError(`Unsupported LLM provider protocol '${url.protocol.replace(":", "")}'`);
  }

  const protocol = url.protocol.slice(0, -1) as LlmProtocol;
  if (protocol === "ollama" && url.pathname.length > 1 && url.hostname) {
    return {
      protocol,
      model: decodeURIComponent(url.pathname.slice(1)),
      baseUrl: `http://${url.host}`,
    };
  }

  const modelName = decodeURIComponent(`${url.hostname}${url.pathname}`.replace(/^\/+/, ""));
  if (!modelName) {
    throw new RuntimeError(`${protocol} URI must include a model name`);
  }
  return { protocol, model: modelName };
}
