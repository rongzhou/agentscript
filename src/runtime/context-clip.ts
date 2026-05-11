import type { Budget } from "../ast/types.js";
import { renderJson } from "./context-render.js";
import type { JsonObject, JsonValue } from "./types.js";

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
  const end = findLargestPrefix(value.length, (count) => renderJson(value.slice(0, count)).length <= maxChars);
  return value.slice(0, end);
}

function clipObjectToBudget(value: JsonObject, maxChars: number): JsonObject {
  const entries = Object.entries(value);
  const end = findLargestPrefix(
    entries.length,
    (count) => renderJson(Object.fromEntries(entries.slice(0, count))).length <= maxChars,
  );
  return Object.fromEntries(entries.slice(0, end));
}

function findLargestPrefix(length: number, fits: (count: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

function budgetToCharLimit(budget?: Budget): number | undefined {
  if (!budget) return undefined;
  const amount = budget.unit === "k" ? budget.amount * 1000 : budget.amount;
  return Math.floor(amount);
}
