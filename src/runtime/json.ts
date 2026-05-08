import type { Budget } from "../ast/types.js";
import { assertNever } from "../utils/assert.js";
import { isRuntimeResource } from "./guards.js";
import type {
  AgentBinding,
  FunctionBinding,
  JsonObject,
  JsonValue,
  LlmBinding,
  MemoryBinding,
  RuntimeValue,
  ToolBinding,
} from "./types.js";

type RuntimeResource = ToolBinding | LlmBinding | FunctionBinding | AgentBinding | MemoryBinding;

export function sanitizeForJson(value: RuntimeValue): JsonValue {
  return sanitizeForJsonValue(value, new WeakSet<object>());
}

export function runtimeValuesEqual(left: RuntimeValue | undefined, right: RuntimeValue | undefined): boolean {
  return renderJsonForComparison(left ?? null) === renderJsonForComparison(right ?? null);
}

function sanitizeForJsonValue(value: RuntimeValue, seen: WeakSet<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (isRuntimeResource(value)) {
    return runtimeResourceToJson(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeForJsonValue(item, seen));
    seen.delete(value);
    return result;
  }

  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = sanitizeForJsonValue(item, seen);
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
