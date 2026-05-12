import { MCP_SCHEME, NODE_SCHEME, NPM_SCHEME } from "./schemes.js";
import { uriScheme } from "./uri.js";

const EFFECTFUL_TOOL_METHODS = new Set(["write", "patch", "delete", "post", "put"]);
const EFFECTFUL_TOOL_SCHEMES = new Set([MCP_SCHEME, NPM_SCHEME, NODE_SCHEME]);

export function isEffectfulToolCall(method: string, uri?: string): boolean {
  if (uri && EFFECTFUL_TOOL_SCHEMES.has(uriScheme(uri))) {
    return true;
  }
  return EFFECTFUL_TOOL_METHODS.has(method);
}
