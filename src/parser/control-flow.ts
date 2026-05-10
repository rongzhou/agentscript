import type { Expr, ForInStmt, IfStmt, LoopUntilStmt, RepeatStmt, Stmt } from "../ast/types.js";
import type { Token } from "./tokenizer.js";

export interface ControlFlowParserHost {
  consume(value: string): Token;
  consumeIdentifier(message: string): Token;
  match(value: string): boolean;
  parseExpression(): Expr;
  parsePositiveInteger(message: string): number;
  parseBlock(): Stmt[];
  previous(): Token;
}

export function parseRepeat(parser: ControlFlowParserHost): RepeatStmt {
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

export function parseForIn(parser: ControlFlowParserHost): ForInStmt {
  const start = parser.consume("for").range.start;
  const item = parser.consumeIdentifier("Expected for item name");
  parser.consume("in");
  const iterable = parser.parseExpression();
  parser.consume("max");
  const maxIterations = parser.parsePositiveInteger("Expected for iteration count");
  const body = parser.parseBlock();
  return {
    kind: "ForInStmt",
    itemName: item.value,
    itemRange: item.range,
    iterable,
    maxIterations,
    body,
    range: { start, end: parser.previous().range.end },
  };
}

export function parseLoop(parser: ControlFlowParserHost): LoopUntilStmt {
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

export function parseIf(parser: ControlFlowParserHost): IfStmt {
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
