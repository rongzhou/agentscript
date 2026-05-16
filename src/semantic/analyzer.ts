import type { AgentDecl, ConfigDecl, Expr, GenerateExpr, Program, SourceRange, Stmt } from "../ast/types.js";
import { REQUIRED_GENERATE_CONFIG_KEYS } from "../language/config.js";
import type { NpmRegistry } from "../language/npm-registry.js";
import { createAgentScope, createFunctionScope, defineAgentFunctions } from "./check-agents.js";
import { collectAssignmentDiagnostics } from "./check-assignment.js";
import { collectCallDiagnostics } from "./check-calls.js";
import { collectConfigDiagnostics, collectGenerateRequiredConfigDiagnostics } from "./check-config.js";
import { SemanticError, errorDiagnostic, type SemanticDiagnostic, type SemanticResult } from "./diagnostics.js";
import { collectGenerateOptionDiagnostics } from "./check-generate.js";
import { collectParallelForDiagnostics } from "./check-parallel-for.js";
import { collectProgramDeclarations, type ImportBindingDecl } from "./check-program.js";
import { collectContractDiagnostics } from "./check-contract.js";
import { SemanticScope } from "./scope.js";
import {
  collectAgentUseDiagnostics,
  collectAgentUseOneOfDiagnostics,
  collectFunctionUseDiagnostics,
  collectFunctionUseOneOfDiagnostics,
} from "./check-use.js";
import { walkExpressionInScope, walkStatementsInScope } from "./walker.js";

export interface AnalyzeOptions {
  npmRegistry?: NpmRegistry;
}

export function analyze(program: Program, options: AnalyzeOptions = {}): SemanticResult {
  const analyzer = new Analyzer(options);
  return analyzer.analyze(program);
}

export function assertSemanticallyValid(program: Program, options: AnalyzeOptions = {}): SemanticResult {
  const result = analyze(program, options);
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
      this.checkAgentUseStatement(use, agentScope);
    }

    for (const fn of agent.functions) {
      this.checkFunction(fn, agentScope);
    }
  }

  private checkFunction(fn: AgentDecl["functions"][number], agentScope: SemanticScope): void {
    const { scope, diagnostics } = createFunctionScope(fn, agentScope);
    this.diagnostics.push(...diagnostics);
    this.checkStatements(fn.body, scope);
  }

  private checkStatements(statements: Stmt[], scope: SemanticScope): void {
    walkStatementsInScope(statements, scope, {
      afterStatement: (stmt, currentScope) => this.checkStatementAfterChildren(stmt, currentScope),
      enterStatement: (stmt, currentScope) => this.checkStatementRules(stmt, currentScope),
      enterExpression: (expr, currentScope) => this.checkExpressionRules(expr, currentScope),
    });
  }

  private checkConfig(config: ConfigDecl, scope: SemanticScope): void {
    this.diagnostics.push(...collectConfigDiagnostics(config, scope));
  }

  private checkAgentUseStatement(stmt: AgentDecl["uses"][number], scope: SemanticScope): void {
    if (stmt.kind === "UseStmt") {
      this.checkExpression(stmt.value, scope);
      this.diagnostics.push(...collectAgentUseDiagnostics(stmt, scope));
      return;
    }
    for (const candidate of stmt.candidates) {
      if (candidate.value) this.checkExpression(candidate.value, scope);
    }
    this.diagnostics.push(...collectAgentUseOneOfDiagnostics(stmt, scope));
  }

  private checkFunctionUseStatement(stmt: Extract<Stmt, { kind: "UseStmt" }>, scope: SemanticScope): void {
    this.diagnostics.push(...collectFunctionUseDiagnostics(stmt, scope));
  }

  private checkFunctionUseOneOfStatement(stmt: Extract<Stmt, { kind: "UseOneOfStmt" }>, scope: SemanticScope): void {
    this.diagnostics.push(...collectFunctionUseOneOfDiagnostics(stmt, scope));
  }

  private checkStatementRules(stmt: Stmt, scope: SemanticScope): false | void {
    switch (stmt.kind) {
      case "ConfigDecl":
        this.checkConfig(stmt, scope);
        return false;
      case "UseStmt":
        this.checkFunctionUseStatement(stmt, scope);
        return;
      case "UseOneOfStmt":
        this.checkFunctionUseOneOfStatement(stmt, scope);
        return;
      case "ForInStmt":
        if (stmt.maxIterations <= 0) {
          this.error("INVALID_ITERATION_LIMIT", "For iteration count must be greater than 0", stmt.range);
        }
        return;
      case "IfStmt":
      case "AssignStmt":
      case "ExprStmt":
      case "LoopUntilStmt":
      case "RepeatStmt":
      case "ReturnStmt":
        return;
    }
  }

  private checkStatementAfterChildren(stmt: Stmt, scope: SemanticScope): void {
    if (stmt.kind === "AssignStmt") {
      this.diagnostics.push(...collectAssignmentDiagnostics(stmt, scope));
    }
  }

  private checkExpression(expr: Expr, scope: SemanticScope): void {
    walkExpressionInScope(expr, scope, {
      enterExpression: (nestedExpr, currentScope) => this.checkExpressionRules(nestedExpr, currentScope),
    });
  }

  private checkExpressionRules(expr: Expr, scope: SemanticScope): false | void {
    switch (expr.kind) {
      case "IdentifierExpr":
        this.checkIdentifier(expr.name, expr.range, scope);
        return;
      case "ContractObjectExpr":
        this.diagnostics.push(...collectContractDiagnostics(expr));
        return;
      case "CallExpr":
        this.diagnostics.push(...collectCallDiagnostics(expr, scope, this.agentDecls));
        return;
      case "GenerateExpr":
        this.checkGenerate(expr, scope);
        return;
      case "ParallelForExpr":
        this.diagnostics.push(...collectParallelForDiagnostics(expr, scope));
        return;
      case "MemberExpr":
      case "IndexExpr":
      case "ListExpr":
      case "ObjectExpr":
      case "UnaryExpr":
      case "BinaryExpr":
      case "StringExpr":
      case "NumberExpr":
      case "BooleanExpr":
      case "NullExpr":
        return;
    }
  }

  private checkIdentifier(name: string, range: SourceRange, scope: SemanticScope): void {
    if (!scope.resolve(name)) {
      this.error("UNKNOWN_IDENTIFIER", `Unknown identifier '${name}'`, range);
    }
  }

  private checkGenerate(expr: GenerateExpr, scope: SemanticScope): void {
    this.diagnostics.push(...collectGenerateOptionDiagnostics(expr));
    if (expr.returnContract) {
      this.diagnostics.push(...collectContractDiagnostics(expr.returnContract));
    }
    for (const key of REQUIRED_GENERATE_CONFIG_KEYS) {
      this.diagnostics.push(...collectGenerateRequiredConfigDiagnostics(key, expr, scope));
    }
  }

  private error(code: string, message: string, range: SourceRange): void {
    this.diagnostics.push(errorDiagnostic(code, message, range));
  }
}
