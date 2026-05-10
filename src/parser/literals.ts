import type { Expr, ListExpr, ObjectExpr, ObjectProperty } from "../ast/types.js";
import type { Token } from "./tokenizer.js";

export interface LiteralParserHost {
  consume(value: string): Token;
  consumeObjectKey(): string;
  consumePropertySeparator(terminator: string): void;
  check(value: string): boolean;
  peek(): Token;
  previous(): Token;
  parseCommaSeparatedUntil<T>(terminator: string, parseItem: () => T): T[];
  parseExpression(): Expr;
}

export function parseObject(parser: LiteralParserHost): ObjectExpr {
  const start = parser.consume("{").range.start;
  const properties: ObjectProperty[] = [];

  while (!parser.check("}") && parser.peek().kind !== "eof") {
    const propStart = parser.peek().range.start;
    const key = parser.consumeObjectKey();
    parser.consume(":");
    const value = parser.parseExpression();
    properties.push({
      kind: "ObjectProperty",
      key,
      value,
      range: { start: propStart, end: value.range.end },
    });
    parser.consumePropertySeparator("}");
  }

  parser.consume("}");
  return {
    kind: "ObjectExpr",
    properties,
    range: { start, end: parser.previous().range.end },
  };
}

export function parseList(parser: LiteralParserHost): ListExpr {
  const start = parser.consume("[").range.start;
  const items = parser.parseCommaSeparatedUntil("]", () => parser.parseExpression());
  parser.consume("]");
  return {
    kind: "ListExpr",
    items,
    range: { start, end: parser.previous().range.end },
  };
}
