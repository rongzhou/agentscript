import { RuntimeError } from "../../runtime/core/errors.js";
import { isObject } from "../../runtime/values/guards.js";
import { sanitizeForJson } from "../../runtime/values/json.js";
import type { JsonObject, RuntimeValue } from "../../runtime/values/values.js";

import type { ToolProvider } from "../../runtime/values/providers.js";

export const DEFAULT_MAX_RESULTS = 100;

export function expectRuntimeObject(value: RuntimeValue | undefined, call: string): Record<string, RuntimeValue> {
  if (!isObject(value ?? null)) {
    throw new RuntimeError(`${call} expects one json object argument`);
  }
  return value as Record<string, RuntimeValue>;
}

export function expectJsonRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function readRequiredString(value: RuntimeValue | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeError(`${name} is required`);
  }
  return value;
}

export function readOptionalString(value: RuntimeValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RuntimeError(`Expected a string, got ${JSON.stringify(sanitizeForJson(value))}`);
  }
  return value;
}

export function readPositiveInteger(value: RuntimeValue | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new RuntimeError(`Expected a positive integer, got ${JSON.stringify(sanitizeForJson(value))}`);
}

export function globMatcher(pattern: string): (value: string) => boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`(^|/)${escaped}$`);
  return (value) => regex.test(value);
}

export function toolUriTarget(uri: string): string {
  const parsed = new URL(uri);
  return parsed.hostname || parsed.pathname.replace(/^\//, "");
}

export function parseJsonOrNull(text: string): RuntimeValue {
  try {
    return JSON.parse(text) as RuntimeValue;
  } catch {
    return null;
  }
}

export function softError(code: string, message: string): JsonObject {
  return { ok: false, code, message };
}

export async function closeDisposableProviders(providers: Record<string, ToolProvider>): Promise<void> {
  const unique = new Set(Object.values(providers));
  await Promise.all([...unique].map((provider) => provider.close?.()));
}
