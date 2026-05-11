import { uriScheme } from "./uri.js";

const EFFECTFUL_TOOL_METHODS = new Set(["write", "patch", "delete", "post", "put"]);
const EFFECTFUL_TOOL_SCHEMES = new Set(["mcp", "npm", "node"]);

export function isEffectfulToolCall(method: string, uri?: string): boolean {
  if (uri && EFFECTFUL_TOOL_SCHEMES.has(uriScheme(uri))) {
    return true;
  }
  return EFFECTFUL_TOOL_METHODS.has(method);
}
