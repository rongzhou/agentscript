import type { ListExpr, ObjectExpr, ObjectProperty } from "../ast/types.js";
import type { ExpressionParserHost } from "./host.js";

export function parseObject(parser: ExpressionParserHost): ObjectExpr {
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

export function parseList(parser: ExpressionParserHost): ListExpr {
  const start = parser.consume("[").range.start;
  const items = parser.parseCommaSeparatedUntil("]", () => parser.parseExpression());
  parser.consume("]");
  return {
    kind: "ListExpr",
    items,
    range: { start, end: parser.previous().range.end },
  };
}
