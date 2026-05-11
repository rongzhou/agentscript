import type { Expr, ItemBinding, Stmt } from "../ast/types.js";
import type { ExpressionParserHost } from "./host.js";

export interface ForTail {
  item: ItemBinding;
  iterable: Expr;
  maxIterations: number;
  body: Stmt[];
}

export function parseForTail(parser: ExpressionParserHost, label: "for" | "parallel for"): ForTail {
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
