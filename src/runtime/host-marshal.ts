import { RuntimeError } from "./errors.js";
import type { JsonObject, JsonValue, RuntimeValue } from "./types.js";

export interface MarshalContext {
  label: string;
}

export function toJsonArg(value: RuntimeValue, context: MarshalContext): JsonValue {
  return toJsonValue(value, context.label, "argument");
}

export function fromHostValue(value: unknown, context: MarshalContext): RuntimeValue {
  return fromHost(value, context.label, "result", new WeakSet<object>());
}

export function requireJsonObject(value: unknown, label: string): JsonObject {
  if (!isPlainObject(value)) {
    throw new RuntimeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function toJsonValue(value: RuntimeValue, label: string, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, label, `${path}[${index}]`));
  }
  if (isRuntimeBinding(value)) {
    throw new RuntimeError(`${label} expects JSON-safe value at ${path}, got ${value.__agentScriptResource} binding`);
  }
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toJsonValue(item, label, `${path}.${key}`);
  }
  return result;
}

function fromHost(value: unknown, label: string, path: string, seen: WeakSet<object>): RuntimeValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new RuntimeError(`${label} returned invalid value at ${path}: number must be finite`);
    }
    return value;
  }
  if (value === undefined) {
    throw new RuntimeError(`${label} returned invalid value at ${path}: undefined is not JSON-safe`);
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throw new RuntimeError(`${label} returned invalid value at ${path}: ${typeof value} is not JSON-safe`);
  }
  if (typeof value !== "object") {
    throw new RuntimeError(`${label} returned invalid value at ${path}: unsupported value`);
  }
  if (seen.has(value)) {
    throw new RuntimeError(`${label} returned invalid value at ${path}: circular reference is not JSON-safe`);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw new RuntimeError(`${label} returned invalid value at ${path}: binary data is not JSON-safe`);
  }
  if (value instanceof Map || value instanceof Set) {
    throw new RuntimeError(`${label} returned invalid value at ${path}: ${value.constructor.name} is not JSON-safe`);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new RuntimeError(`${label} returned invalid value at ${path}: class instance is not JSON-safe`);
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item, index) => fromHost(item, label, `${path}[${index}]`, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, RuntimeValue> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = fromHost(item, label, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRuntimeBinding(value: object): value is { __agentScriptResource: string } {
  return (
    "__agentScriptResource" in value &&
    typeof (value as { __agentScriptResource?: unknown }).__agentScriptResource === "string"
  );
}
