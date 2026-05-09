import type { SourceLocation, SourceRange } from "../ast/types.js";
import { ParseError } from "./errors.js";

export type TokenKind =
  | "identifier"
  | "keyword"
  | "string"
  | "number"
  | "symbol"
  | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  range: SourceRange;
}

const KEYWORDS = new Set([
  "import",
  "main",
  "agent",
  "func",
  "use",
  "loop",
  "until",
  "repeat",
  "for",
  "in",
  "return",
  "if",
  "else",
  "and",
  "or",
  "not",
  "generate",
  "from",
  "true",
  "false",
  "none",
  "string",
  "number",
  "boolean",
  "json",
  "list",
  "max"
]);

const SYMBOLS = new Set([
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ".",
  ",",
  ":",
  "=",
  "!",
  "<",
  "-",
  "*"
]);

export function tokenize(source: string): Token[] {
  const scanner = new Scanner(source);
  return scanner.scanAll();
}

class Scanner {
  private offset = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly source: string) {}

  scanAll(): Token[] {
    const tokens: Token[] = [];

    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.isAtEnd()) {
        break;
      }

      const start = this.location();
      const char = this.peek();

      if (char === '"' || char === "'") {
        tokens.push(this.scanString());
        continue;
      }

      if (isDigit(char)) {
        tokens.push(this.scanNumber());
        continue;
      }

      if (isIdentifierStart(char)) {
        tokens.push(this.scanIdentifier());
        continue;
      }

      if (SYMBOLS.has(char)) {
        const twoChar = `${char}${this.peekNext()}`;
        if (twoChar === "==" || twoChar === "!=" || twoChar === "->") {
          this.advance();
          this.advance();
          tokens.push({
            kind: "symbol",
            value: twoChar,
            range: { start, end: this.location() }
          });
          continue;
        }
        this.advance();
        tokens.push({
          kind: "symbol",
          value: char,
          range: { start, end: this.location() }
        });
        continue;
      }

      throw new ParseError(`Unexpected character '${char}'`, start);
    }

    const location = this.location();
    tokens.push({
      kind: "eof",
      value: "",
      range: { start: location, end: location }
    });

    return tokens;
  }

  private scanString(): Token {
    const quote = this.peek();
    const start = this.location();
    this.advance();

    let value = "";
    while (!this.isAtEnd() && this.peek() !== quote) {
      const char = this.advance();
      if (char === "\\") {
        value += this.scanEscape(start);
      } else {
        value += char;
      }
    }

    if (this.isAtEnd()) {
      throw new ParseError("Unterminated string literal", start);
    }

    this.advance();
    return {
      kind: "string",
      value,
      range: { start, end: this.location() }
    };
  }

  private scanEscape(start: SourceLocation): string {
    if (this.isAtEnd()) {
      throw new ParseError("Unterminated escape sequence", start);
    }

    const escaped = this.advance();
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return escaped;
    }
  }

  private scanNumber(): Token {
    const start = this.location();
    let value = "";

    while (!this.isAtEnd() && isDigit(this.peek())) {
      value += this.advance();
    }

    if (!this.isAtEnd() && this.peek() === ".") {
      value += this.advance();
      while (!this.isAtEnd() && isDigit(this.peek())) {
        value += this.advance();
      }
    }

    if (!this.isAtEnd() && isIdentifierStart(this.peek())) {
      while (!this.isAtEnd() && isIdentifierPart(this.peek())) {
        value += this.advance();
      }
    }

    return {
      kind: "number",
      value,
      range: { start, end: this.location() }
    };
  }

  private scanIdentifier(): Token {
    const start = this.location();
    let value = "";

    while (!this.isAtEnd() && isIdentifierPart(this.peek())) {
      value += this.advance();
    }

    return {
      kind: KEYWORDS.has(value) ? "keyword" : "identifier",
      value,
      range: { start, end: this.location() }
    };
  }

  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      while (!this.isAtEnd() && isWhitespace(this.peek())) {
        this.advance();
      }
      if (this.peek() === "/" && this.peekNext() === "/") {
        while (!this.isAtEnd() && this.peek() !== "\n") {
          this.advance();
        }
        continue;
      }
      return;
    }
  }

  private peek(): string {
    return this.source[this.offset] ?? "\0";
  }

  private peekNext(): string {
    return this.source[this.offset + 1] ?? "\0";
  }

  private advance(): string {
    const char = this.source[this.offset] ?? "\0";
    this.offset += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return char;
  }

  private isAtEnd(): boolean {
    return this.offset >= this.source.length;
  }

  private location(): SourceLocation {
    return {
      line: this.line,
      column: this.column,
      offset: this.offset
    };
  }
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isIdentifierStart(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentifierPart(char: string): boolean {
  const code = char.charCodeAt(0);
  return isIdentifierStart(char) || (code >= 48 && code <= 57) || code === 45;
}
