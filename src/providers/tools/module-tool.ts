import { RuntimeError } from "../../runtime/errors.js";
import { fromHostValue, requireJsonObject, toJsonArg } from "../../runtime/host-marshal.js";
import { isObject } from "../../runtime/guards.js";
import type { RuntimeValue, ToolCallRequest } from "../../runtime/types.js";

export interface ModuleInvokeInfo {
  schemeLabel: "npm" | "node";
  toolLabel: string;
}

export async function invokeModuleMember(
  mod: unknown,
  request: ToolCallRequest,
  info: ModuleInvokeInfo,
): Promise<RuntimeValue> {
  const normalized = normalizeRequest(request);
  const target = readModuleMember(mod, normalized.method);
  const label = `${capitalize(info.schemeLabel)} tool '${info.toolLabel}.${normalized.method}'`;
  if (request.propertyRead) {
    if (typeof target === "function") {
      throw new RuntimeError(`'${info.toolLabel}.${normalized.method}' is a function and cannot be read as a property`);
    }
    return fromHostValue(target, { label });
  }

  if (typeof target !== "function") {
    if (normalized.args.length > 0) {
      throw new RuntimeError(`'${info.toolLabel}.${normalized.method}' is not a function`);
    }
    return fromHostValue(target, { label });
  }

  const args = normalized.args.map((arg, index) => toJsonArg(arg, { label: `${label} argument at position ${index}` }));
  try {
    return fromHostValue(await target(...args), { label });
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeError(`${info.schemeLabel} tool '${info.toolLabel}.${normalized.method}' failed: ${message}`);
  }
}

function normalizeRequest(request: ToolCallRequest): { method: string; args: RuntimeValue[] } {
  if (request.method !== "call") {
    return { method: request.method, args: request.args };
  }
  if (request.args.length !== 1 || !isObject(request.args[0])) {
    throw new RuntimeError(`${request.toolName}.call expects one object argument`);
  }
  const call = requireJsonObject(request.args[0], `${request.toolName}.call argument`);
  if (typeof call.method !== "string" || call.method.length === 0) {
    throw new RuntimeError(`${request.toolName}.call method must be a non-empty string`);
  }
  if (!Array.isArray(call.args)) {
    throw new RuntimeError(`${request.toolName}.call args must be a list`);
  }
  return { method: call.method, args: call.args };
}

function readModuleMember(mod: unknown, method: string): unknown {
  if (!isRecord(mod)) {
    throw new RuntimeError("Imported module namespace is not an object");
  }
  if (method in mod) {
    return mod[method];
  }
  const fallback = mod.default;
  if (isRecord(fallback) && method in fallback) {
    return fallback[method];
  }
  throw new RuntimeError(`Unknown method '${method}'`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
