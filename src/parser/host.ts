import type { Expr, Stmt } from "../ast/types.js";
import type { Token } from "./tokenizer.js";

export interface TokenParserHost {
  check(value: string): boolean;
  consume(value: string): Token;
  consumeIdentifier(message: string): Token;
  match(value: string): boolean;
  peek(): Token;
  previous(): Token;
}

export interface ExpressionParserHost extends TokenParserHost {
  parseExpression(): Expr;
}

export interface BlockParserHost extends ExpressionParserHost {
  parseBlock(): Stmt[];
}
