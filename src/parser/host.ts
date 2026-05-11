import type { Budget, Expr, Stmt } from "../ast/types.js";
import type { ParseError } from "./errors.js";
import type { Token } from "./tokenizer.js";

export interface TokenParserHost {
  check(value: string): boolean;
  consume(value: string): Token;
  consumeIdentifier(message: string): Token;
  consumeKind(kind: Token["kind"], message: string): Token;
  error(message: string): ParseError;
  isAtEnd(): boolean;
  match(value: string): boolean;
  matchAny(values: readonly string[]): boolean;
  matchKind(kind: Token["kind"]): boolean;
  peek(): Token;
  previous(): Token;
}

export interface ExpressionParserHost extends TokenParserHost {
  consumeObjectKey(): string;
  consumePropertySeparator(terminator: string): void;
  consumeShapeFieldSeparator(terminator: string): void;
  parseBlock(): Stmt[];
  parseBudgetToken(token: Token): Budget;
  parseCommaSeparatedUntil<T>(terminator: string, parseItem: () => T): T[];
  parseExpression(): Expr;
  parsePositiveInteger(message: string): number;
}

export interface BlockParserHost extends ExpressionParserHost {}
