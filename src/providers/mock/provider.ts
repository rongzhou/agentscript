import { ENV_SCHEME, FILE_SCHEME } from "../../language/schemes.js";
import { uriScheme } from "../../language/uri.js";
import { sanitizeForJson } from "../../runtime/json.js";
import { buildValueFromJsonSchema } from "../../runtime/schema-defaults.js";
import type {
  GenerateRequest,
  LlmProvider,
  MemoryAddRequest,
  MemoryProvider,
  MemoryQueryRequest,
  RuntimeValue,
  ToolCallRequest,
  ToolProvider,
} from "../../runtime/types.js";

export class MockLlmProvider implements LlmProvider {
  async generate(request: GenerateRequest): Promise<RuntimeValue> {
    return request.builtContext.returnSchema ? buildValueFromJsonSchema(request.builtContext.returnSchema) : null;
  }
}

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

export class MockMemoryProvider implements MemoryProvider {
  private readonly records: RuntimeValue[] = [];

  async add(request: MemoryAddRequest): Promise<RuntimeValue> {
    const record = {
      id: String(this.records.length + 1),
      created_at: "mock",
      updated_at: "mock",
      record: request.record,
    };
    this.records.push(record);
    return record;
  }

  async query(_request: MemoryQueryRequest): Promise<RuntimeValue> {
    return [...this.records].reverse();
  }
}
