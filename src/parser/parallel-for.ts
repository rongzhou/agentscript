import type { Expr, ParallelForExpr, Stmt } from "../ast/types.js";
import type { Token } from "./tokenizer.js";

export interface ParallelForParserHost {
  consume(value: string): Token;
  consumeIdentifier(message: string): Token;
  parseExpression(): Expr;
  parsePositiveInteger(message: string): number;
  parseBlock(): Stmt[];
  previous(): Token;
}

export function parseParallelFor(parser: ParallelForParserHost): ParallelForExpr {
  const start = parser.consume("parallel").range.start;
  parser.consume("for");
  const item = parser.consumeIdentifier("Expected parallel for item name");
  parser.consume("in");
  const iterable = parser.parseExpression();
  parser.consume("max");
  const maxIterations = parser.parsePositiveInteger("Expected parallel for item count");
  const body = parser.parseBlock();
  return {
    kind: "ParallelForExpr",
    itemName: item.value,
    itemRange: item.range,
    iterable,
    maxIterations,
    body,
    range: { start, end: parser.previous().range.end },
  };
}
