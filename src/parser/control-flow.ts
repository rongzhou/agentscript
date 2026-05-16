import type {
  Expr,
  ForInStmt,
  IfStmt,
  ItemBinding,
  LoopUntilStmt,
  ParallelForExpr,
  RepeatStmt,
  Stmt,
} from "../ast/types.js";
import type { ExpressionParserHost } from "./host.js";

interface ForTail {
  item: ItemBinding;
  iterable: Expr;
  maxIterations: number;
  body: Stmt[];
}

function parseForTail(parser: ExpressionParserHost, label: "for" | "parallel for"): ForTail {
  const item = parser.consumeIdentifier(`Expected ${label} item name`);
  parser.consume("in");
  const iterable = parser.parseExpression();
  parser.consume("max");
  const maxIterations = parser.parsePositiveInteger(`Expected ${label} iteration count`);
  const body = parser.parseBlock();
  return {
    item: { name: item.value, range: item.range },
    iterable,
    maxIterations,
    body,
  };
}

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
