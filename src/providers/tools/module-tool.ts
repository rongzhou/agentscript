import type { NODE_SCHEME, NPM_SCHEME } from "../../language/schemes.js";
import { RuntimeError } from "../../runtime/core/errors.js";
import { fromHostValue, toJsonArg } from "../../runtime/values/host-marshal.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest } from "../../runtime/values/providers.js";

export interface ModuleInvokeInfo {
  schemeLabel: typeof NPM_SCHEME | typeof NODE_SCHEME;
  toolLabel: string;
}

export async function invokeModuleMember(
  mod: unknown,
  request: ToolCallRequest,
  info: ModuleInvokeInfo,
): Promise<RuntimeValue> {
  const target = readModuleMember(mod, request.method);
  const label = `${capitalize(info.schemeLabel)} tool '${info.toolLabel}.${request.method}'`;
  if (request.propertyRead) {
    if (typeof target === "function") {
      throw new RuntimeError(`'${info.toolLabel}.${request.method}' is a function and cannot be read as a property`);
    }
    return fromHostValue(target, { label });
  }

  if (typeof target !== "function") {
    if (request.args.length > 0) {
      throw new RuntimeError(`'${info.toolLabel}.${request.method}' is not a function`);
    }
    return fromHostValue(target, { label });
  }

  const args = request.args.map((arg, index) => toJsonArg(arg, { label: `${label} argument at position ${index}` }));
  try {
    return fromHostValue(await target(...args), { label });
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeError(`${info.schemeLabel} tool '${info.toolLabel}.${request.method}' failed: ${message}`);
  }
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
