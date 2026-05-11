import type { AgentDecl, ConfigDecl, Expr, GenerateExpr, Program, SourceRange, Stmt } from "../ast/types.js";
import { childExpressions } from "../ast/walk.js";
import { REQUIRED_GENERATE_CONFIG_KEYS } from "../language/config.js";
import type { NpmRegistry } from "../providers/tools/npm-registry.js";
import { createAgentScope, createFunctionScope, defineAgentFunctions } from "./agents.js";
import { checkAssignmentStatement } from "./assignment.js";
import { checkCallExpression } from "./calls.js";
import { checkConfigDeclaration, checkGenerateRequiredConfig } from "./config.js";
import {
  checkForInStatement,
  checkIfStatement,
  checkLoopUntilStatement,
  checkRepeatStatement,
} from "./control-flow.js";
import { SemanticError, errorDiagnostic, type SemanticDiagnostic, type SemanticResult } from "./diagnostics.js";
import { checkGenerateOptions } from "./generate.js";
import { blockEndsWithExpression, checkParallelForBodyRules } from "./parallel-for.js";
import { collectProgramDeclarations, type ImportBindingDecl } from "./program.js";
import { checkShapeObject } from "./shape.js";
import { SemanticScope } from "./scope.js";
import { checkUseRules } from "./use.js";

export interface AnalyzeOptions {
  npmRegistry?: NpmRegistry;
}

export function analyze(program: Program, options: AnalyzeOptions = {}): SemanticResult {
  const analyzer = new Analyzer(options);
  return analyzer.analyze(program);
}

export function assertSemanticallyValid(program: Program): SemanticResult {
  const result = analyze(program);
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new SemanticError(errors);
  }
  return result;
}

class Analyzer {
  private diagnostics: SemanticDiagnostic[] = [];
  private readonly agentDecls = new Map<string, AgentDecl>();
  private readonly importBindings = new Map<string, ImportBindingDecl>();

  constructor(private readonly options: AnalyzeOptions = {}) {}

  analyze(program: Program): SemanticResult {
    const declarations = collectProgramDeclarations(program, this.options);
    this.diagnostics.push(...declarations.diagnostics);
    for (const [name, agent] of declarations.agentDecls) {
      this.agentDecls.set(name, agent);
    }
    for (const [name, imported] of declarations.importBindings) {
      this.importBindings.set(name, imported);
    }

    for (const agent of program.agents) {
      this.checkAgent(agent, program);
    }
    return { diagnostics: this.diagnostics };
  }

  private checkAgent(agent: AgentDecl, program: Program): void {
    const agentScope = createAgentScope(program, this.importBindings);
    this.diagnostics.push(...defineAgentFunctions(agent, agentScope));

    for (const config of agent.config) {
      this.checkConfig(config, agentScope);
    }
    for (const use of agent.uses) {
      this.checkUse(use, agentScope, true);
    }

    for (const fn of agent.functions) {
      this.checkFunction(fn, agentScope);
    }
  }

  private checkFunction(fn: AgentDecl["functions"][number], agentScope: SemanticScope): void {
    const { scope, diagnostics } = createFunctionScope(fn, agentScope);
    this.diagnostics.push(...diagnostics);

    for (const stmt of fn.body) {
      this.checkStatement(stmt, scope);
    }
  }

  private checkStatement(stmt: Stmt, scope: SemanticScope): void {
    switch (stmt.kind) {
      case "ConfigDecl":
        this.checkConfig(stmt, scope);
        break;
      case "UseStmt":
        this.checkUse(stmt, scope, false);
        break;
      case "AssignStmt":
        this.diagnostics.push(
          ...checkAssignmentStatement(stmt, scope, {
            checkExpression: (expr, currentScope) => this.checkExpression(expr, currentScope),
          }),
        );
        break;
      case "ExprStmt":
        this.checkExpression(stmt.expr, scope);
        break;
      case "IfStmt":
        checkIfStatement(stmt, scope, {
          checkBlock: (statements, currentScope) => this.checkBlock(statements, currentScope),
          checkExpression: (expr, currentScope) => this.checkExpression(expr, currentScope),
        });
        break;
      case "ForInStmt":
        this.diagnostics.push(
          ...checkForInStatement(stmt, scope, {
            checkBlock: (statements, currentScope) => this.checkBlock(statements, currentScope),
            checkExpression: (expr, currentScope) => this.checkExpression(expr, currentScope),
          }),
        );
        break;
      case "LoopUntilStmt":
        checkLoopUntilStatement(stmt, scope, {
          checkBlock: (statements, currentScope) => this.checkBlock(statements, currentScope),
          checkExpression: (expr, currentScope) => this.checkExpression(expr, currentScope),
        });
        break;
      case "RepeatStmt":
        checkRepeatStatement(stmt, scope, {
          checkBlock: (statements, currentScope) => this.checkBlock(statements, currentScope),
          checkExpression: (expr, currentScope) => this.checkExpression(expr, currentScope),
        });
        break;
      case "ReturnStmt":
        this.checkExpression(stmt.value, scope);
        break;
    }
  }

  private checkConfig(config: ConfigDecl, scope: SemanticScope): void {
    this.diagnostics.push(...checkConfigDeclaration(config, scope));
  }

  private checkUse(stmt: Extract<Stmt, { kind: "UseStmt" }>, scope: SemanticScope, agentLevel: boolean): void {
    this.checkExpression(stmt.value, scope);
    this.diagnostics.push(...checkUseRules(stmt, scope, agentLevel));
  }

  private checkBlock(statements: Stmt[], scope: SemanticScope): void {
    for (const stmt of statements) {
      this.checkStatement(stmt, scope);
    }
  }

  private checkExpression(expr: Expr, scope: SemanticScope): void {
    switch (expr.kind) {
      case "IdentifierExpr":
        this.checkIdentifier(expr.name, expr.range, scope);
        break;
      case "StringExpr":
      case "NumberExpr":
      case "BooleanExpr":
      case "NullExpr":
        break;
      case "MemberExpr":
      case "IndexExpr":
      case "ListExpr":
      case "ObjectExpr":
      case "UnaryExpr":
      case "BinaryExpr":
        for (const child of childExpressions(expr)) {
          this.checkExpression(child, scope);
        }
        break;
      case "ShapeObjectExpr":
        this.diagnostics.push(...checkShapeObject(expr));
        break;
      case "CallExpr":
        checkCallExpression(expr, scope, this.agentDecls, {
          checkExpression: (nestedExpr, nestedScope) => this.checkExpression(nestedExpr, nestedScope),
          error: (code, message, range) => this.error(code, message, range),
        });
        break;
      case "GenerateExpr":
        this.checkGenerate(expr, scope);
        break;
      case "ParallelForExpr":
        this.checkParallelFor(expr, scope);
        break;
    }
  }

  private checkParallelFor(expr: Extract<Expr, { kind: "ParallelForExpr" }>, scope: SemanticScope): void {
    this.checkExpression(expr.iterable, scope);
    if (expr.maxIterations <= 0) {
      this.error("INVALID_PARALLEL_FOR_LIMIT", "parallel for item count must be greater than 0", expr.range);
    }
    if (!blockEndsWithExpression(expr.body)) {
      this.error("INVALID_PARALLEL_FOR_BODY", "parallel for body must end with a value expression", expr.range);
    }
    const child = scope.child();
    void child.define(expr.itemName, { kind: "local", range: expr.itemRange });
    this.checkParallelForBody(expr.body, child);
  }

  private checkParallelForBody(statements: Stmt[], scope: SemanticScope): void {
    this.diagnostics.push(...checkParallelForBodyRules(statements, scope));
    for (const stmt of statements) {
      this.checkStatement(stmt, scope);
    }
  }

  private checkIdentifier(name: string, range: SourceRange, scope: SemanticScope): void {
    if (!scope.resolve(name)) {
      this.error("UNKNOWN_IDENTIFIER", `Unknown identifier '${name}'`, range);
    }
  }

  private checkGenerate(expr: GenerateExpr, scope: SemanticScope): void {
    for (const property of expr.options.properties) {
      this.checkExpression(property.value, scope);
    }
    this.diagnostics.push(...checkGenerateOptions(expr));
    if (expr.returnShape) {
      this.diagnostics.push(...checkShapeObject(expr.returnShape));
    }
    for (const key of REQUIRED_GENERATE_CONFIG_KEYS) {
      this.diagnostics.push(...checkGenerateRequiredConfig(key, expr, scope));
    }
  }

  private error(code: string, message: string, range: SourceRange): void {
    this.diagnostics.push(errorDiagnostic(code, message, range));
  }
}
