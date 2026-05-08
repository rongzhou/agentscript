import type { SourceRange } from "../ast/types.js";

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly range?: SourceRange,
  ) {
    super(formatRuntimeMessage(message, range));
    this.name = "RuntimeError";
  }
}

function formatRuntimeMessage(message: string, range?: SourceRange): string {
  if (!range) {
    return message;
  }
  return `${message} at ${range.start.line}:${range.start.column}`;
}
