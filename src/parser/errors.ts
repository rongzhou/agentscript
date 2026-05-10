import { formatSourceLocation } from "../ast/format.js";
import type { SourceLocation } from "../ast/types.js";

export class ParseError extends Error {
  readonly location: SourceLocation;

  constructor(message: string, location: SourceLocation) {
    super(`${message} at ${formatSourceLocation(location)}`);
    this.name = "ParseError";
    this.location = location;
  }
}
