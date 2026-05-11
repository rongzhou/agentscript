import type { ForInStmt, IfStmt, LoopUntilStmt, RepeatStmt } from "../ast/types.js";
import { parseForTail } from "./for-tail.js";
import type { ExpressionParserHost } from "./host.js";

export function parseRepeat(parser: ExpressionParserHost): RepeatStmt {
  const start = parser.consume("repeat").range.start;
  parser.consume("*");
  const maxAttempts = parser.parsePositiveInteger("Expected repeat count");
  const body = parser.parseBlock();
  return {
    kind: "RepeatStmt",
    maxAttempts,
    body,
    range: { start, end: parser.previous().range.end },
  };
}

export function parseForIn(parser: ExpressionParserHost): ForInStmt {
  const start = parser.consume("for").range.start;
  const tail = parseForTail(parser, "for");
  return {
    kind: "ForInStmt",
    ...tail,
    range: { start, end: parser.previous().range.end },
  };
}

export function parseLoop(parser: ExpressionParserHost): LoopUntilStmt {
  const start = parser.consume("loop").range.start;
  parser.consume("until");
  const condition = parser.parseExpression();
  parser.consume("max");
  const maxIterations = parser.parsePositiveInteger("Expected loop iteration count");
  const body = parser.parseBlock();
  return {
    kind: "LoopUntilStmt",
    condition,
    maxIterations,
    body,
    range: { start, end: parser.previous().range.end },
  };
}

export function parseIf(parser: ExpressionParserHost): IfStmt {
  const start = parser.consume("if").range.start;
  const condition = parser.parseExpression();
  const thenBody = parser.parseBlock();
  const elseBody = parser.match("else") ? parser.parseBlock() : undefined;
  return {
    kind: "IfStmt",
    condition,
    thenBody,
    elseBody,
    range: { start, end: parser.previous().range.end },
  };
}
