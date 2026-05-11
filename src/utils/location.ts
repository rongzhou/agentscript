import type { SourceLocation, SourceRange } from "../ast/types.js";

export function formatSourceLocation(location: SourceLocation): string {
  return `${location.line}:${location.column}`;
}

export function formatSourceRangeStart(range: SourceRange): string {
  return formatSourceLocation(range.start);
}
