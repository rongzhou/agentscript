import type { SourceLocation } from "../ast/types.js";
import { formatSourceLocation } from "../utils/location.js";

export class ParseError extends Error {
  readonly location: SourceLocation;

  constructor(message: string, location: SourceLocation) {
    super(`${message} at ${formatSourceLocation(location)}`);
    this.name = "ParseError";
    this.location = location;
  }
}
