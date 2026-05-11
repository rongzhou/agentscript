import type { JsonValue } from "./types.js";

export function renderJson(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
