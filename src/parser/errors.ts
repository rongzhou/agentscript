import type { SourceLocation } from "../ast/types.js";

export class ParseError extends Error {
  readonly location: SourceLocation;

  constructor(message: string, location: SourceLocation) {
    super(`${message} at ${location.line}:${location.column}`);
    this.name = "ParseError";
    this.location = location;
  }
}
