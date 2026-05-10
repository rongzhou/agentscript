import type {
  AgentDecl,
  AssignStmt,
  BinaryExpr,
  BooleanExpr,
  Budget,
  CallExpr,
  ConfigDecl,
  ConfigKey,
  Expr,
  ExprStmt,
  FuncDecl,
  FuncParam,
  IdentifierExpr,
  ImportDecl,
  ImportResourceKind,
  IndexExpr,
  MemberExpr,
  NullExpr,
  NumberExpr,
  Program,
  ReturnStmt,
  Stmt,
  StringExpr,
  UnaryExpr,
  UseStmt,
} from "../ast/types.js";
import { ParseError } from "./errors.js";
import { parseForIn, parseIf, parseLoop, parseRepeat } from "./control-flow.js";
import { parseGenerate } from "./generate.js";
import { parseList, parseObject } from "./literals.js";
import { parseParallelFor } from "./parallel-for.js";
import { parseShapeObject } from "./shape.js";
import { type Token, tokenize } from "./tokenizer.js";

export function parse(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}

const IMPORT_RESOURCE_KINDS = new Set<ImportResourceKind>(["tool", "llm", "file", "agent", "memory"]);
const CONFIG_KEYS = new Set<ConfigKey>(["model", "role", "description"]);
const ANONYMOUS_MAIN_AGENT = "__main_agent";
const ANONYMOUS_MAIN_FUNC = "__main";

class Parser {
  private current = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const start = this.peek().range.start;
    const imports: ImportDecl[] = [];
    const agents: AgentDecl[] = [];

    while (!this.isAtEnd()) {
      if (this.check("import")) {
        imports.push(this.parseImport());
      } else if (this.check("agent") || this.check("main")) {
        agents.push(this.parseAgent());
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

  private parseImport(): ImportDecl {
    const start = this.consume("import").range.start;
    const resourceToken = this.consumeIdentifier("Expected import resource kind");
    const resourceKind = resourceToken.value;
    if (!isImportResourceKind(resourceKind)) {
      throw new ParseError(
        "Expected import resource kind 'tool', 'llm', 'file', 'agent', or 'memory'",
        resourceToken.range.start,
      );
    }
    const name = this.consumeIdentifier(`Expected ${resourceKind} name`).value;
    this.consume("from");
    const uri = this.consumeKind("string", `Expected ${resourceKind} URI`).value;

    return {
      kind: "ImportDecl",
      resourceKind,
      name,
      uri,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseAgent(): AgentDecl {
    const mainToken = this.match("main") ? this.previous() : undefined;
    const start = (mainToken ?? this.peek()).range.start;
    const isMain = Boolean(mainToken);
    this.consume("agent");
    const name = this.check("{") ? ANONYMOUS_MAIN_AGENT : this.consumeIdentifier("Expected agent name").value;
    if (!isMain && name === ANONYMOUS_MAIN_AGENT) {
      throw this.error("Only main agent can omit its name");
    }
    this.consume("{");

    const config: ConfigDecl[] = [];
    const functions: FuncDecl[] = [];

    while (!this.check("}") && !this.isAtEnd()) {
      if (this.isConfigKey(this.peek().value)) {
        config.push(this.parseConfigDecl());
      } else if (this.check("func") || this.check("main")) {
        functions.push(this.parseFunc());
      } else {
        throw this.error("Expected configuration declaration or function declaration");
      }
    }

    this.consume("}");
    return {
      kind: "AgentDecl",
      name,
      isMain,
      config,
      functions,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseConfigDecl(): ConfigDecl {
    const key = this.consumeConfigKey();
    const value = this.parseConfigValue(key.value);
    return {
      kind: "ConfigDecl",
      key: key.value,
      value,
      range: { start: key.range.start, end: value.range.end },
    };
  }

  private parseFunc(): FuncDecl {
    const mainToken = this.match("main") ? this.previous() : undefined;
    const start = (mainToken ?? this.peek()).range.start;
    const isMain = Boolean(mainToken);
    this.consume("func");
    const name = this.check("(") ? ANONYMOUS_MAIN_FUNC : this.consumeIdentifier("Expected function name").value;
    if (!isMain && name === ANONYMOUS_MAIN_FUNC) {
      throw this.error("Only main func can omit its name");
    }
    this.consume("(");
    const params = this.parseCommaSeparatedUntil(")", () => this.parseFuncParam());
    this.consume(")");
    const body = this.parseBlock();

    return {
      kind: "FuncDecl",
      name,
      isMain,
      params,
      body,
      range: { start, end: this.previous().range.end },
    };
  }

  private parseFuncParam(): FuncParam {
    const token = this.consumeIdentifier("Expected parameter name");
    const shape = this.check("{") ? parseShapeObject(this, { allowDefaultStringFields: false }) : undefined;
    return {
      kind: "FuncParam",
      name: token.value,
      shape,
      range: { start: token.range.start, end: (shape ?? token).range.end },
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

  private parseUse(): UseStmt {
    const start = this.consume("use").range.start;
    const value = this.parseLogicalOr();
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

  private parseUseLabel(): string {
    const line = this.previous().range.start.line;
    let label: string;
    if (this.matchKind("string")) {
      label = this.previous().value;
    } else if (this.matchKind("identifier") || this.matchKind("keyword")) {
      label = this.previous().value;
    } else {
      throw this.error("Expected identifier or string context label after 'as'");
    }
    if (!this.isAtEnd() && !this.check("}") && this.peek().range.start.line === line) {
      throw this.error("Expected newline after context label");
    }
    return label;
  }

  private parseConfigValue(key: ConfigKey): Expr {
    if (key === "model") {
      return this.parsePostfix();
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
        throw new ParseError("Assignment target must be an identifier or member expression", expr.range.start);
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
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): Expr {
    return this.parseBinaryExpression(() => this.parseLogicalAnd(), "or");
  }

  private parseLogicalAnd(): Expr {
    return this.parseBinaryExpression(() => this.parseEquality(), "and");
  }

  private parseEquality(): Expr {
    return this.parseBinaryExpression(() => this.parseComparison(), "==", "!=");
  }

  private parseComparison(): Expr {
    return this.parseBinaryExpression(() => this.parseTerm(), "<", ">");
  }

  private parseTerm(): Expr {
    return this.parseBinaryExpression(() => this.parseUnary(), "+", "-");
  }

  private parseBinaryExpression(parseOperand: () => Expr, ...operators: BinaryExpr["operator"][]): Expr {
    let expr = parseOperand();
    while (this.matchAny(operators)) {
      const operator = this.previous().value as BinaryExpr["operator"];
      const right = parseOperand();
      expr = {
        kind: "BinaryExpr",
        operator,
        left: expr,
        right,
        range: { start: expr.range.start, end: right.range.end },
      } satisfies BinaryExpr;
    }
    return expr;
  }

  private parseUnary(): Expr {
    if (this.match("not")) {
      const start = this.previous().range.start;
      const value = this.parseUnary();
      return {
        kind: "UnaryExpr",
        operator: "not",
        value,
        range: { start, end: value.range.end },
      } satisfies UnaryExpr;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(".")) {
        const property = this.consumeIdentifier("Expected property name").value;
        expr = {
          kind: "MemberExpr",
          object: expr,
          property,
          range: { start: expr.range.start, end: this.previous().range.end },
        } satisfies MemberExpr;
        continue;
      }

      if (this.match("(")) {
        const args = this.parseCommaSeparatedUntil(")", () => this.parseExpression());
        this.consume(")");
        expr = {
          kind: "CallExpr",
          callee: expr,
          args,
          range: { start: expr.range.start, end: this.previous().range.end },
        } satisfies CallExpr;
        continue;
      }

      if (this.match("[")) {
        const index = this.parseExpression();
        this.consume("]");
        expr = {
          kind: "IndexExpr",
          object: expr,
          index,
          range: { start: expr.range.start, end: this.previous().range.end },
        } satisfies IndexExpr;
        continue;
      }

      break;
    }

    return expr;
  }

  private parsePrimary(): Expr {
    const token = this.peek();

    if (this.check("generate")) {
      return parseGenerate(this);
    }

    if (this.check("parallel")) {
      return parseParallelFor(this);
    }

    if (this.matchKind("string")) {
      return {
        kind: "StringExpr",
        value: token.value,
        range: token.range,
      } satisfies StringExpr;
    }

    if (this.matchKind("number")) {
      return {
        kind: "NumberExpr",
        value: Number.parseFloat(token.value),
        raw: token.value,
        range: token.range,
      } satisfies NumberExpr;
    }

    if (this.match("true") || this.match("false")) {
      return {
        kind: "BooleanExpr",
        value: token.value === "true",
        range: token.range,
      } satisfies BooleanExpr;
    }

    if (this.match("none")) {
      return {
        kind: "NullExpr",
        range: token.range,
      } satisfies NullExpr;
    }

    if (this.check("{")) {
      return parseObject(this);
    }

    if (this.check("[")) {
      return parseList(this);
    }

    if (this.matchKind("identifier") || this.matchKind("keyword")) {
      return {
        kind: "IdentifierExpr",
        name: token.value,
        range: token.range,
      } satisfies IdentifierExpr;
    }

    throw this.error("Expected expression");
  }

  consumePropertySeparator(terminator: string): void {
    if (this.check(terminator)) return;
    this.consume(",");
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

  private matchAny(values: readonly string[]): boolean {
    if (!values.some((value) => this.check(value))) {
      return false;
    }
    this.advance();
    return true;
  }

  private matchKind(kind: Token["kind"]): boolean {
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
      this.match(",");
    }
    return items;
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.current += 1;
    }
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().kind === "eof";
  }

  peek(): Token {
    return this.tokens[this.current]!;
  }

  previous(): Token {
    return this.tokens[this.current - 1] ?? this.tokens[0]!;
  }

  private error(message: string): ParseError {
    return new ParseError(message, this.peek().range.start);
  }

  private isConfigKey(value: string): value is ConfigKey {
    return CONFIG_KEYS.has(value as ConfigKey);
  }
}

function isImportResourceKind(value: string): value is ImportResourceKind {
  return IMPORT_RESOURCE_KINDS.has(value as ImportResourceKind);
}
