import { ENV_SCHEME, FILE_SCHEME } from "../../language/schemes.js";
import { uriScheme } from "../../language/uri.js";
import { sanitizeForJson } from "../../runtime/values/json.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";

export class MockToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const scheme = uriScheme(request.uri);
    if (scheme === FILE_SCHEME && request.method === "read") {
      return {
        ok: true,
        content: `mock file content from ${request.uri}`,
      };
    }
    if (scheme === FILE_SCHEME && request.method === "list") {
      return {
        ok: true,
        entries: [],
      };
    }
    if (scheme === ENV_SCHEME && request.method === "get") {
      return {
        ok: true,
        value: null,
      };
    }
    return {
      ok: true,
      summary: `${request.toolName}.${request.method}`,
      source: request.uri,
      args: sanitizeForJson(request.args),
    };
  }
}
