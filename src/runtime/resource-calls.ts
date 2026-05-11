import type { MemberExpr } from "../ast/types.js";
import { MEMORY_ADD_METHOD, MEMORY_QUERY_METHOD } from "../language/memory.js";
import { uriScheme } from "../language/uri.js";
import { RuntimeError } from "./errors.js";
import { isObject } from "./guards.js";
import { sanitizeForJson } from "./json.js";
import type {
  JsonValue,
  MemoryBinding,
  MemoryProvider,
  RuntimeValue,
  ToolBinding,
  ToolProvider,
  TraceEvent,
} from "./types.js";

export class ResourceCallRuntime {
  constructor(
    private readonly toolProvider: ToolProvider,
    private readonly memoryProvider: MemoryProvider,
    private readonly trace: TraceEvent[],
  ) {}

  async callTool(
    object: ToolBinding,
    callee: MemberExpr,
    args: RuntimeValue[],
    propertyRead = false,
  ): Promise<RuntimeValue> {
    const request = {
      toolName: object.name,
      uri: object.uri,
      method: callee.property,
      args,
      propertyRead,
    };
    let result: RuntimeValue;
    try {
      result = await this.toolProvider.call(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(`Tool ${object.name}.${callee.property} (${object.uri}) failed: ${message}`, callee.range);
    }
    this.trace.push({
      kind: "tool",
      data: {
        tool: object.name,
        method: callee.property,
        scheme: uriScheme(object.uri),
        uri: object.uri,
        args: sanitizeForJson(args),
        result: sanitizeForJson(result),
        effects: readEffects(result),
      },
    });
    return result;
  }

  async callMemory(object: MemoryBinding, callee: MemberExpr, args: RuntimeValue[]): Promise<RuntimeValue> {
    if (args.length !== 1) {
      throw new RuntimeError(`memory.${callee.property} expects exactly one argument`, callee.range);
    }

    let result: RuntimeValue;
    try {
      if (callee.property === MEMORY_ADD_METHOD) {
        result = await this.memoryProvider.add({
          memoryName: object.name,
          uri: object.uri,
          record: args[0]!,
        });
      } else if (callee.property === MEMORY_QUERY_METHOD) {
        result = await this.memoryProvider.query({
          memoryName: object.name,
          uri: object.uri,
          query: args[0]!,
        });
      } else {
        throw new RuntimeError(`Unknown memory method '${callee.property}'`, callee.range);
      }
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw error.range ? error : new RuntimeError(error.message, callee.range);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(
        `Memory ${object.name}.${callee.property} (${object.uri}) failed: ${message}`,
        callee.range,
      );
    }

    const traceData = {
      memory: object.name,
      operation: callee.property,
      uri: object.uri,
      args: sanitizeForJson(args[0]!),
      result: sanitizeForJson(result),
      count: Array.isArray(result) ? result.length : null,
    };
    if (callee.property === MEMORY_ADD_METHOD && isObject(result)) {
      Object.assign(traceData, {
        id: typeof result.id === "string" ? result.id : null,
        record: sanitizeForJson(result.record),
      });
    }
    this.trace.push({
      kind: "memory",
      data: traceData,
    });
    return result;
  }
}

export function isModuleTool(value: ToolBinding): boolean {
  const scheme = uriScheme(value.uri);
  return scheme === "npm" || scheme === "node";
}

function readEffects(value: RuntimeValue): JsonValue {
  if (isObject(value) && Array.isArray(value.effects)) {
    return sanitizeForJson(value.effects);
  }
  return null;
}
