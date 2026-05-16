import type { Budget } from "../../ast/types.js";
import { renderJson } from "../values/json.js";
import type { JsonObject, JsonValue } from "../values/values.js";

export function clipJson(
  value: JsonValue,
  budget?: Budget,
): { value: JsonValue; text: string; clipped: boolean; originalSize: number; clippedSize: number } {
  const maxChars = budgetToCharLimit(budget);
  const text = renderJson(value);
  if (!maxChars || text.length <= maxChars) {
    return { value, text, clipped: false, originalSize: text.length, clippedSize: text.length };
  }
  const clippedValue = clipValueToBudget(value, maxChars);
  const clippedText = renderJson(clippedValue);
  return {
    value: clippedValue,
    text: clippedText,
    clipped: clippedText !== text,
    originalSize: text.length,
    clippedSize: clippedText.length,
  };
}

function clipValueToBudget(value: JsonValue, maxChars: number): JsonValue {
  if (typeof value === "string") return value.slice(0, maxChars);
  if (Array.isArray(value)) return clipArrayToBudget(value, maxChars);
  if (value && typeof value === "object") return clipObjectToBudget(value as JsonObject, maxChars);
  return value;
}

function clipArrayToBudget(value: JsonValue[], maxChars: number): JsonValue[] {
  const end = renderedPrefixCount(
    value.map((item) => renderJson(item)),
    maxChars,
  );
  return value.slice(0, end);
}

function clipObjectToBudget(value: JsonObject, maxChars: number): JsonObject {
  const entries = Object.entries(value);
  const end = renderedPrefixCount(
    entries.map(([key, item]) => `${JSON.stringify(key)}: ${renderJson(item)}`),
    maxChars,
  );
  return Object.fromEntries(entries.slice(0, end));
}

function renderedPrefixCount(renderedItems: string[], maxChars: number): number {
  if (renderedItems.length === 0) return 0;
  let length = 4; // "[\n" + "\n]" or "{\n" + "\n}"
  let count = 0;
  for (const renderedItem of renderedItems) {
    const nextLength = length + indentedLength(renderedItem) + (count > 0 ? 2 : 0);
    if (nextLength > maxChars) {
      break;
    }
    length = nextLength;
    count += 1;
  }
  return count;
}

function indentedLength(text: string): number {
  return text.length + 2 * text.split("\n").length;
}

function budgetToCharLimit(budget?: Budget): number | undefined {
  if (!budget) return undefined;
  const amount = budget.unit === "k" ? budget.amount * 1000 : budget.amount;
  return Math.floor(amount);
}
