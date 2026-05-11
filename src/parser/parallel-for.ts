import type { ParallelForExpr } from "../ast/types.js";
import type { BlockParserHost } from "./host.js";

export interface ParallelForParserHost extends BlockParserHost {}

export function parseParallelFor(parser: ParallelForParserHost): ParallelForExpr {
  const start = parser.consume("parallel").range.start;
  parser.consume("for");
  const item = parser.consumeIdentifier("Expected parallel for item name");
  parser.consume("in");
  const iterable = parser.parseExpression();
  parser.consume("max");
  const maxIterations = parser.parsePositiveInteger("Expected parallel for iteration count");
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
