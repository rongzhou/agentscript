import type { JsonPrimitive, JsonValue } from "./types.js";

export const CONTINUE_JSON_WALK = Symbol("continue_json_walk");
export const OMIT_JSON_VALUE = Symbol("omit_json_value");

export type JsonWalkValue = JsonValue | typeof OMIT_JSON_VALUE;

export interface JsonWalkPolicy {
  primitive?: (value: JsonPrimitive, path: string) => JsonWalkValue;
  unsupported: (value: unknown, path: string) => JsonWalkValue;
  circular: (value: object, path: string) => JsonWalkValue;
  object?: (value: object, path: string) => JsonWalkValue | typeof CONTINUE_JSON_WALK;
}

export function mapJsonLikeValue(
  value: unknown,
  path: string,
  policy: JsonWalkPolicy,
  seen = new WeakSet<object>(),
): JsonWalkValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return policy.primitive ? policy.primitive(value, path) : value;
  }
  if (typeof value !== "object") {
    return policy.unsupported(value, path);
  }

  const mappedObject = policy.object?.(value, path);
  if (mappedObject !== undefined && mappedObject !== CONTINUE_JSON_WALK) {
    return mappedObject;
  }
  if (seen.has(value)) {
    return policy.circular(value, path);
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item, index) => {
      const mapped = mapJsonLikeValue(item, `${path}[${index}]`, policy, seen);
      return mapped === OMIT_JSON_VALUE ? null : mapped;
    });
    seen.delete(value);
    return result;
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const mapped = mapJsonLikeValue(item, `${path}.${key}`, policy, seen);
    if (mapped !== OMIT_JSON_VALUE) {
      result[key] = mapped;
    }
  }
  seen.delete(value);
  return result;
}
