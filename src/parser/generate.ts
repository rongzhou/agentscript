import type { Budget, Expr, GenerateExpr, GenerateOptionsExpr, NumberExpr, ObjectProperty } from "../ast/types.js";
import type { ExpressionParserHost } from "./host.js";
import { parseShapeObject } from "./shape.js";

export interface GenerateParserHost extends ExpressionParserHost {}

export function parseGenerate(parser: GenerateParserHost): GenerateExpr {
  const start = parser.consume("generate").range.start;
  parser.consume("(");
  const options = parseGenerateOptions(parser);
  parser.consume(")");
  const returnShape = parser.match("->") ? parseShapeObject(parser, { mode: "shorthand" }) : undefined;

  return {
    kind: "GenerateExpr",
    options,
    returnShape,
    range: { start, end: parser.previous().range.end },
  };
}

function parseGenerateOptions(parser: GenerateParserHost): GenerateOptionsExpr {
  const start = parser.consume("{").range.start;
  const properties: ObjectProperty[] = [];
  let maxOutput: Budget | undefined;

  while (!parser.check("}") && !parser.isAtEnd()) {
    const propStart = parser.peek().range.start;
    const key = parser.consumeObjectKey();
    parser.consume(":");
    let value: Expr;
    if (key === "max_output") {
      const token = parser.consumeKind("number", "Expected generate max_output");
      maxOutput = parser.parseBudgetToken(token);
      value = {
        kind: "NumberExpr",
        value: Number.parseFloat(token.value),
        raw: token.value,
        range: token.range,
      } satisfies NumberExpr;
    } else {
      value = parser.parseExpression();
    }
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
    kind: "GenerateOptionsExpr",
    properties,
    maxOutput,
    range: { start, end: parser.previous().range.end },
  };
}
