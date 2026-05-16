import type { SourceLocation, SourceRange } from "../ast/types.js";
import { formatSourceLocation } from "../ast/location.js";

export class ParseError extends Error {
  readonly location: SourceLocation;
  readonly range: SourceRange;

  constructor(message: string, location: SourceLocation, range?: SourceRange) {
    super(`${message} at ${formatSourceLocation(location)}`);
    this.name = "ParseError";
    this.location = location;
    this.range = range ?? { start: location, end: location };
  }
}
