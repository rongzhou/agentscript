import type { Budget } from "../ast/types.js";
import { assertNever } from "../utils/assert.js";
import { isRuntimeResource } from "./guards.js";
import { CONTINUE_JSON_WALK, mapJsonLikeValue, OMIT_JSON_VALUE, type JsonWalkPolicy } from "./json-walk.js";
import type { JsonObject, JsonValue, RuntimeResource, RuntimeValue } from "./types.js";

export function sanitizeForJson(value: unknown): JsonValue {
  const sanitized = mapJsonLikeValue(value, "value", SANITIZE_JSON_POLICY);
  return sanitized === OMIT_JSON_VALUE ? null : sanitized;
}

export function runtimeValuesEqual(left: RuntimeValue | undefined, right: RuntimeValue | undefined): boolean {
  return renderJsonForComparison(left ?? null) === renderJsonForComparison(right ?? null);
}

const SANITIZE_JSON_POLICY: JsonWalkPolicy = {
  unsupported(value) {
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
      return OMIT_JSON_VALUE;
    }
    if (typeof value === "bigint") {
      throw new TypeError("Cannot sanitize bigint value for JSON");
    }
    return OMIT_JSON_VALUE;
  },
  circular() {
    return "[Circular]";
  },
  object(value) {
    if (value instanceof Map || value instanceof Set) {
      throw new TypeError("Cannot sanitize Map or Set value for JSON");
    }
    const runtimeValue = value as RuntimeValue;
    return isRuntimeResource(runtimeValue) ? runtimeResourceToJson(runtimeValue) : CONTINUE_JSON_WALK;
  },
};

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
