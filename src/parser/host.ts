import type { Budget, ConfigDecl, Expr, SourceLocation, SourceRange, Stmt, UseDecl } from "../ast/types.js";
import type { ParseError } from "./errors.js";
import type { Token } from "./tokenizer.js";

interface TokenParserHost {
  check(value: string): boolean;
  consume(value: string): Token;
  consumeIdentifier(message: string): Token;
  consumeKind(kind: Token["kind"], message: string): Token;
  error(message: string): ParseError;
  errorAt(message: string, location: SourceLocation): ParseError;
  errorAtRange(message: string, range: SourceRange): ParseError;
  isAtEnd(): boolean;
  match(value: string): boolean;
  matchAny(values: readonly string[]): boolean;
  matchKind(kind: Token["kind"]): boolean;
  peek(): Token;
  previous(): Token;
}

export interface ExpressionParserHost extends TokenParserHost {
  consumeObjectKey(): string;
  consumeContractBlockEntrySeparator(terminator: string): void;
  consumePropertySeparator(terminator: string): void;
  parseBlock(): Stmt[];
  parseBudgetToken(token: Token): Budget;
  parseCommaSeparatedUntil<T>(terminator: string, parseItem: () => T): T[];
  parseExpression(): Expr;
  parsePositiveInteger(message: string): number;
}

export interface DeclarationParserHost extends ExpressionParserHost {
  isConfigKey(value: string): boolean;
  parseConfigDecl(): ConfigDecl;
  parseUse(): UseDecl;
}

export interface ContractParserHost extends TokenParserHost {
  consumeContractBlockEntrySeparator(terminator: string): void;
}
