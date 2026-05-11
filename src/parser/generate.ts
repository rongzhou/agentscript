import type {
  Budget,
  GenerateExpr,
  GenerateOptionsExpr,
  NumberExpr,
  ObjectProperty,
  SourceRange,
} from "../ast/types.js";
import type { ExpressionParserHost } from "./host.js";
import { parseShapeObject } from "./shape.js";

export function parseGenerate(parser: ExpressionParserHost): GenerateExpr {
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

function parseGenerateOptions(parser: ExpressionParserHost): GenerateOptionsExpr {
  const start = parser.consume("{").range.start;
  const properties: ObjectProperty[] = [];
  let maxOutput: Budget | undefined;
  let maxOutputRange: SourceRange | undefined;

  while (!parser.check("}") && !parser.isAtEnd()) {
    const propStart = parser.peek().range.start;
    const key = parser.consumeObjectKey();
    parser.consume(":");
    if (key === "max_output") {
      const token = parser.consumeKind("number", "Expected generate max_output");
      maxOutput = parser.parseBudgetToken(token);
      maxOutputRange = token.range;
      properties.push({
        kind: "ObjectProperty",
        key,
        value: numberExprFromToken(token),
        range: { start: propStart, end: token.range.end },
      });
    } else {
      const value = parser.parseExpression();
      properties.push({
        kind: "ObjectProperty",
        key,
        value,
        range: { start: propStart, end: value.range.end },
      });
    }
    parser.consumePropertySeparator("}");
  }
  parser.consume("}");
  return {
    kind: "GenerateOptionsExpr",
    properties,
    maxOutput,
    maxOutputRange,
    range: { start, end: parser.previous().range.end },
  };
}

function numberExprFromToken(token: { value: string; range: SourceRange }): NumberExpr {
  return {
    kind: "NumberExpr",
    value: Number.parseFloat(token.value),
    raw: token.value,
    range: token.range,
  };
}
