import { sanitizeForJson } from "../../runtime/json.js";
import { buildValueFromShape } from "../../runtime/shape.js";
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
    return request.returnShape ? buildValueFromShape(request.returnShape) : null;
  }
}

export class MockToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    return {
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
