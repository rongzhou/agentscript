import type { ParallelForExpr } from "../ast/types.js";
import { parseForTail } from "./for-tail.js";
import type { ExpressionParserHost } from "./host.js";

export function parseParallelFor(parser: ExpressionParserHost): ParallelForExpr {
  const start = parser.consume("parallel").range.start;
  parser.consume("for");
  const tail = parseForTail(parser, "parallel for");
  return {
    kind: "ParallelForExpr",
    ...tail,
    range: { start, end: parser.previous().range.end },
  };
}
