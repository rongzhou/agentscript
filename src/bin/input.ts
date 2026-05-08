import type { JsonObject, RuntimeValue } from "../runtime/types.js";

export function parseJsonObjectInput(source: string, label: string): JsonObject {
  const value = JSON.parse(source) as RuntimeValue;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

export function parseInteractiveInputValue(value: string): RuntimeValue {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  try {
    return JSON.parse(trimmed) as RuntimeValue;
  } catch {
    return value;
  }
}
