import type { SourceRange } from "../../ast/types.js";
import { formatSourceRangeStart } from "../../ast/format.js";

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly range?: SourceRange,
  ) {
    super(range ? `${message} at ${formatSourceRangeStart(range)}` : message);
    this.name = "RuntimeError";
  }
}
