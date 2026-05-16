import type {
  AgentDecl,
  AssignStmt,
  Budget,
  ConfigDecl,
  ConfigKey,
  Expr,
  ExprStmt,
  ImportDecl,
  Program,
  ReturnStmt,
  Stmt,
  UseOneOfCandidate,
  UseOneOfStmt,
  UseStmt,
} from "../ast/types.js";
import { isConfigKey } from "../language/config.js";
import { ParseError } from "./errors.js";
import { parseForIn, parseIf, parseLoop, parseRepeat } from "./control-flow.js";
import { parseAgentDecl, parseImportDecl } from "./declarations.js";
import { parseExpressionExpr, parsePostfixExpr } from "./expressions.js";
import { parseLabelledBlock } from "./labelled-block.js";
import { isNewLineBetween, isOnSameLine, type Token, tokenize } from "./tokenizer.js";

export function parse(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}

class Parser {
  private current = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const start = this.peek().range.start;
    const imports: ImportDecl[] = [];
    const agents: AgentDecl[] = [];

    while (!this.isAtEnd()) {
      if (this.check("import")) {
        imports.push(parseImportDecl(this));
      } else if (this.check("agent") || this.check("main")) {
        agents.push(parseAgentDecl(this));
      } else {
        throw this.error(`Expected 'import', 'agent', or 'main agent'`);
      }
    }

    return {
      kind: "Program",
      imports,
      agents,
      range: { start, end: this.previous().range.end },
    };
  }

  parseConfigDecl(): ConfigDecl {
    const key = this.consumeConfigKey();
    const value = this.parseConfigValue(key.value);
    return {
      kind: "ConfigDecl",
      key: key.value,
      value,
      range: { start: key.range.start, end: value.range.end },
    };
  }

  parseBlock(): Stmt[] {
    this.consume("{");
    const statements: Stmt[] = [];
    while (!this.check("}") && !this.isAtEnd()) {
      statements.push(this.parseStatement());
    }
    this.consume("}");
    return statements;
  }

  private parseStatement(): Stmt {
    if (this.isConfigKey(this.peek().value)) {
      return this.parseConfigDecl();
    }
    if (this.check("use")) {
      return this.parseUse();
    }
    if (this.check("return")) {
      return this.parseReturn();
    }
    if (this.check("repeat")) {
      return parseRepeat(this);
    }
    if (this.check("for")) {
      return parseForIn(this);
    }
    if (this.check("loop")) {
      return parseLoop(this);
    }
    if (this.check("if")) {
      return parseIf(this);
    }
    return this.parseAssignmentOrExpressionStatement();
  }

  parseUse(): UseStmt | UseOneOfStmt {
    const start = this.consume("use").range.start;
    if (this.check("one") && this.peekNext().value === "of") {
      this.consume("one");
      this.consume("of");
      return this.parseUseOneOf(start);
    }
    const value = this.parseExpression();
    const budget = this.match("max") ? this.parseBudget() : undefined;
    const label = this.match("as") ? this.parseUseLabel() : undefined;
    return {
      kind: "UseStmt",
      value,
      budget,
      label,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseUseOneOf(start: UseOneOfStmt["range"]["start"]): UseOneOfStmt {
    const block = parseLabelledBlock(this, {
      fieldNameMessage: "Expected use one of candidate name",
      parseValue: () => this.parseUseOneOfCandidateValue(),
    });
    if (block.entries.length < 2) {
      throw this.errorAtRange("use one of requires at least two candidates", block.range);
    }
    const selected = block.entries.filter((entry) => entry.value.selected);
    if (selected.length > 1) {
      throw this.errorAtRange("use one of can mark at most one candidate as selected", selected[1]!.range);
    }
    this.consume("as");
    const label = this.parseUseLabel();
    return {
      kind: "UseOneOfStmt",
      candidates: block.entries.map((entry) => ({
        kind: "UseOneOfCandidate",
        name: entry.name,
        value: entry.value.value,
        budget: entry.value.budget,
        selected: entry.value.selected,
        range: entry.range,
      })),
      label,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseUseOneOfCandidateValue(): Omit<UseOneOfCandidate, "kind" | "name"> {
    const start = this.peek().range.start;
    if (this.match("empty")) {
      const selected = this.match("selected");
      return {
        selected,
        range: { start, end: this.previous().range.end },
      };
    }

    const value = this.parseExpression();
    const budget = this.match("max") ? this.parseBudget() : undefined;
    const selected = this.match("selected");
    return {
      value,
      budget,
      selected,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseUseLabel(): string {
    const asToken = this.previous();
    let label: string;
    if (this.matchKind("string")) {
      label = this.previous().value;
    } else if (this.matchKind("identifier") || this.matchKind("keyword")) {
      label = this.previous().value;
    } else {
      throw this.error("Expected identifier or string context label after 'as'");
    }
    if (!this.isAtEnd() && !this.check("}") && isOnSameLine(asToken, this.peek())) {
      throw this.error("Expected newline after context label");
    }
    return label;
  }

  private parseConfigValue(key: ConfigKey): Expr {
    if (key === "model") {
      return parsePostfixExpr(this);
    }
    return this.parseExpression();
  }

  private parseReturn(): ReturnStmt {
    const start = this.consume("return").range.start;
    const value = this.parseExpression();
    return {
      kind: "ReturnStmt",
      value,
      range: { start, end: value.range.end },
    };
  }

  private parseAssignmentOrExpressionStatement(): AssignStmt | ExprStmt {
    const expr = this.parseExpression();
    if (this.matchAny(["=", "+=", "-="])) {
      const operator = this.previous().value as AssignStmt["operator"];
      if (expr.kind !== "IdentifierExpr" && expr.kind !== "MemberExpr") {
        throw this.errorAt("Assignment target must be an identifier or member expression", expr.range.start);
      }
      const value = this.parseExpression();
      return {
        kind: "AssignStmt",
        target: expr,
        operator,
        value,
        range: { start: expr.range.start, end: value.range.end },
      };
    }

    return {
      kind: "ExprStmt",
      expr,
      range: expr.range,
    };
  }

  parseExpression(): Expr {
    return parseExpressionExpr(this);
  }

  consumePropertySeparator(terminator: string): void {
    if (this.check(terminator)) return;
    this.consume(",");
  }

  consumeContractBlockEntrySeparator(terminator: string): void {
    if (this.check(terminator)) return;
    if (this.match(",")) {
      throw this.error("Commas are not allowed between contract block entries; use newlines");
    }
    if (isNewLineBetween(this.previous(), this.peek())) return;
    throw this.error("Expected newline between contract block entries");
  }

  private parseBudget(): Budget {
    return this.parseBudgetToken(this.consumeKind("number", "Expected budget amount"));
  }

  parseBudgetToken(token: Token): Budget {
    const raw = token.value;
    const match = /^(\d+(?:\.\d+)?)([A-Za-z]+)?$/.exec(raw);
    if (!match) {
      throw this.error(`Invalid budget '${raw}'`);
    }
    return {
      amount: Number.parseFloat(match[1] ?? raw),
      unit: match[2],
    };
  }

  parsePositiveInteger(message: string): number {
    const raw = this.consumeKind("number", message).value;
    if (!/^\d+$/.test(raw)) {
      throw this.error(message);
    }
    return Number.parseInt(raw, 10);
  }

  consumeObjectKey(): string {
    if (this.matchKind("identifier") || this.matchKind("keyword") || this.matchKind("string")) {
      return this.previous().value;
    }
    throw this.error("Expected object key");
  }

  private consumeConfigKey(): Token & { value: ConfigKey } {
    const token = this.consumeIdentifier("Expected configuration key");
    if (!this.isConfigKey(token.value)) {
      throw this.error("Expected configuration key");
    }
    return token as Token & { value: ConfigKey };
  }

  consumeIdentifier(message: string): Token {
    if (this.matchKind("identifier") || this.matchKind("keyword")) {
      return this.previous();
    }
    throw this.error(message);
  }

  consumeKind(kind: Token["kind"], message: string): Token {
    if (this.matchKind(kind)) {
      return this.previous();
    }
    throw this.error(message);
  }

  consume(value: string): Token {
    if (this.match(value)) {
      return this.previous();
    }
    throw this.error(`Expected '${value}'`);
  }

  match(value: string): boolean {
    if (!this.check(value)) {
      return false;
    }
    this.advance();
    return true;
  }

  matchAny(values: readonly string[]): boolean {
    if (!values.some((value) => this.check(value))) {
      return false;
    }
    this.advance();
    return true;
  }

  matchKind(kind: Token["kind"]): boolean {
    if (!this.checkKind(kind)) {
      return false;
    }
    this.advance();
    return true;
  }

  check(value: string): boolean {
    return this.peek().value === value;
  }

  private checkKind(kind: Token["kind"]): boolean {
    return this.peek().kind === kind;
  }

  parseCommaSeparatedUntil<T>(terminator: string, parseItem: () => T): T[] {
    const items: T[] = [];
    while (!this.check(terminator) && !this.isAtEnd()) {
      items.push(parseItem());
      if (!this.check(terminator)) {
        this.consume(",");
      }
    }
    return items;
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.current += 1;
    }
    return this.previous();
  }

  isAtEnd(): boolean {
    return this.peek().kind === "eof";
  }

  peek(): Token {
    return this.tokens[this.current]!;
  }

  private peekNext(): Token {
    const next = this.tokens[this.current + 1];
    if (next) return next;
    const eof = this.tokens[this.tokens.length - 1];
    if (!eof || eof.kind !== "eof") {
      throw new Error("Parser token stream is missing EOF token");
    }
    return eof;
  }

  previous(): Token {
    return this.tokens[this.current - 1] ?? this.tokens[0]!;
  }

  error(message: string): ParseError {
    return new ParseError(message, this.peek().range.start);
  }

  errorAt(message: string, location: Token["range"]["start"]): ParseError {
    return new ParseError(message, location);
  }

  errorAtRange(message: string, range: Token["range"]): ParseError {
    return new ParseError(message, range.start, range);
  }

  isConfigKey(value: string): value is ConfigKey {
    return isConfigKey(value);
  }
}
