import type { Budget } from "../ast/types.js";
import { assertNever } from "../utils/assert.js";
import { isRuntimeResource } from "./guards.js";
import type { JsonObject, JsonValue, RuntimeResource, RuntimeValue } from "./types.js";

export function sanitizeForJson(value: RuntimeValue): JsonValue {
  const sanitized = sanitizeForJsonValue(value, new WeakSet<object>());
  return sanitized === OMIT_JSON_VALUE ? null : sanitized;
}

export function runtimeValuesEqual(left: RuntimeValue | undefined, right: RuntimeValue | undefined): boolean {
  return renderJsonForComparison(left ?? null) === renderJsonForComparison(right ?? null);
}

const OMIT_JSON_VALUE = Symbol("omit_json_value");

type SanitizedJsonValue = JsonValue | typeof OMIT_JSON_VALUE;

function sanitizeForJsonValue(value: unknown, seen: WeakSet<object>): SanitizedJsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return OMIT_JSON_VALUE;
  }
  if (typeof value === "bigint") {
    throw new TypeError("Cannot sanitize bigint value for JSON");
  }
  if (value instanceof Map || value instanceof Set) {
    throw new TypeError("Cannot sanitize Map or Set value for JSON");
  }
  if (typeof value === "object") {
    const runtimeValue = value as RuntimeValue;
    if (isRuntimeResource(runtimeValue)) {
      return runtimeResourceToJson(runtimeValue);
    }
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => {
      const sanitized = sanitizeForJsonValue(item, seen);
      return sanitized === OMIT_JSON_VALUE ? null : sanitized;
    });
    seen.delete(value);
    return result;
  }

  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeForJsonValue(item, seen);
    if (sanitized !== OMIT_JSON_VALUE) {
      result[key] = sanitized;
    }
  }
  seen.delete(value);
  return result;
}

function renderJsonForComparison(value: RuntimeValue): string {
  return JSON.stringify(sanitizeForJson(value));
}

function runtimeResourceToJson(value: RuntimeResource): JsonObject {
  switch (value.__agentScriptResource) {
    case "tool":
      return { tool: value.name, uri: value.uri };
    case "llm":
      return { llm: value.name, uri: value.uri };
    case "function":
      return { function: value.name, agent: value.agentName };
    case "agent":
      return { agent: value.name };
    case "memory":
      return { memory: value.name, uri: value.uri };
    default:
      assertNever(value);
  }
}

export function budgetToJson(budget: Budget | undefined): JsonValue {
  if (!budget) {
    return null;
  }
  return {
    amount: budget.amount,
    unit: budget.unit ?? null,
  };
}
