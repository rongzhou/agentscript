import type { MemberExpr } from "../../ast/types.js";
import { MEMORY_ADD_METHOD, type MemoryMethod, getMemoryMethodSpec } from "../../language/memory.js";
import { NODE_SCHEME, NPM_SCHEME } from "../../language/schemes.js";
import { uriScheme } from "../../language/uri.js";
import { RuntimeError } from "../core/errors.js";
import { isObject } from "../values/guards.js";
import { sanitizeForJson } from "../values/json.js";
import { buildTraceEvent } from "./trace.js";
import type { JsonValue, MemoryBinding, RuntimeValue, ToolBinding } from "../values/values.js";
import type { MemoryProvider, ToolProvider } from "../values/providers.js";
import type { TraceEvent } from "./trace.js";

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
    const result = await callProvider(
      () => this.toolProvider.call(request),
      `Tool ${object.name}.${callee.property} (${object.uri})`,
      callee,
    );
    this.trace.push(
      buildTraceEvent("tool", {
        tool: object.name,
        method: callee.property,
        scheme: uriScheme(object.uri),
        uri: object.uri,
        args,
        result,
        effects: readEffects(result),
      }),
    );
    return result;
  }

  async readToolMember(object: ToolBinding, member: MemberExpr): Promise<RuntimeValue> {
    if (isModuleTool(object)) {
      return this.callTool(object, member, [], true);
    }
    return { tool: object.name, method: member.property };
  }

  async callMemory(object: MemoryBinding, callee: MemberExpr, args: RuntimeValue[]): Promise<RuntimeValue> {
    const spec = getMemoryMethodSpec(callee.property);
    if (!spec) {
      throw new RuntimeError(`Unknown memory method '${callee.property}'`, callee.range);
    }
    if (args.length !== spec.arity) {
      throw new RuntimeError(
        `Memory method '${object.name}.${callee.property}' expects ${spec.arity} argument(s), got ${args.length}`,
        callee.range,
      );
    }

    const method = callee.property as MemoryMethod;
    const result = await callProvider(
      () => this.dispatchMemoryCall(method, object, args),
      `Memory ${object.name}.${callee.property} (${object.uri})`,
      callee,
    );

    this.trace.push(buildTraceEvent("memory", memoryTraceData(object, method, args[0]!, result)));
    return result;
  }

  private dispatchMemoryCall(method: MemoryMethod, object: MemoryBinding, args: RuntimeValue[]): Promise<RuntimeValue> {
    if (method === MEMORY_ADD_METHOD) {
      return this.memoryProvider.add({
        memoryName: object.name,
        uri: object.uri,
        record: args[0]!,
      });
    }
    return this.memoryProvider.query({
      memoryName: object.name,
      uri: object.uri,
      query: args[0]!,
    });
  }
}

function memoryTraceData(object: MemoryBinding, method: MemoryMethod, arg: RuntimeValue, result: RuntimeValue) {
  const traceData = {
    memory: object.name,
    operation: method,
    uri: object.uri,
    args: arg,
    result,
    count: Array.isArray(result) ? result.length : null,
  };
  if (method === MEMORY_ADD_METHOD && isObject(result)) {
    Object.assign(traceData, {
      id: typeof result.id === "string" ? result.id : null,
      record: result.record,
    });
  }
  return traceData;
}

function isModuleTool(value: ToolBinding): boolean {
  const scheme = uriScheme(value.uri);
  return scheme === NPM_SCHEME || scheme === NODE_SCHEME;
}

function readEffects(value: RuntimeValue): JsonValue {
  if (isObject(value) && Array.isArray(value.effects)) {
    return sanitizeForJson(value.effects);
  }
  return null;
}

async function callProvider(
  call: () => Promise<RuntimeValue>,
  label: string,
  callee: MemberExpr,
): Promise<RuntimeValue> {
  try {
    return await call();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeError(`${label} failed: ${message}`, callee.range);
  }
}
