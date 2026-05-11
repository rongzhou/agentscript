import { RuntimeError } from "../../runtime/errors.js";
import type { LlmBinding } from "../../runtime/types.js";
import { SUPPORTED_LLM_PROTOCOL_SET, type LlmProtocol, type ParsedLlmUri } from "./types.js";

export function parseLlmUri(model: LlmBinding): ParsedLlmUri {
  if (!model.uri.includes("://")) {
    throw new RuntimeError("LLM URI must use an explicit protocol URL form");
  }
  const url = new URL(model.uri);
  const protocolName = url.protocol.slice(0, -1);
  if (!isSupportedLlmProtocol(protocolName)) {
    throw new RuntimeError(`Unsupported LLM provider protocol '${protocolName}'`);
  }

  const protocol = protocolName;
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

function isSupportedLlmProtocol(value: string): value is LlmProtocol {
  return SUPPORTED_LLM_PROTOCOL_SET.has(value as LlmProtocol);
}
