import type { Token } from "./tokenizer.js";

export function isNewLineBetween(prev: Token, next: Token): boolean {
  return prev.range.end.line < next.range.start.line;
}

export function isOnSameLine(a: Token, b: Token): boolean {
  return a.range.start.line === b.range.start.line;
}
