import type { Expr, Stmt } from "../ast/types.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";
import { SemanticScope } from "./scope.js";
import { scopeWithItemBinding } from "./walker.js";

export interface ControlFlowCheckHost {
  checkBlock(statements: Stmt[], scope: SemanticScope): void;
  checkExpression(expr: Expr, scope: SemanticScope): void;
}

export function checkIfStatement(
  stmt: Extract<Stmt, { kind: "IfStmt" }>,
  scope: SemanticScope,
  host: ControlFlowCheckHost,
): SemanticDiagnostic[] {
  host.checkExpression(stmt.condition, scope);
  host.checkBlock(stmt.thenBody, scope.child());
  if (stmt.elseBody) {
    host.checkBlock(stmt.elseBody, scope.child());
  }
  return [];
}

export function checkForInStatement(
  stmt: Extract<Stmt, { kind: "ForInStmt" }>,
  scope: SemanticScope,
  host: ControlFlowCheckHost,
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  host.checkExpression(stmt.iterable, scope);
  if (stmt.maxIterations <= 0) {
    diagnostics.push(error("INVALID_ITERATION_LIMIT", "For iteration count must be greater than 0", stmt.range));
  }
  host.checkBlock(stmt.body, scopeWithItemBinding(scope, stmt.item));
  return diagnostics;
}

export function checkLoopUntilStatement(
  stmt: Extract<Stmt, { kind: "LoopUntilStmt" }>,
  scope: SemanticScope,
  host: ControlFlowCheckHost,
): SemanticDiagnostic[] {
  host.checkExpression(stmt.condition, scope);
  host.checkBlock(stmt.body, scope.child());
  return [];
}

export function checkRepeatStatement(
  stmt: Extract<Stmt, { kind: "RepeatStmt" }>,
  scope: SemanticScope,
  host: ControlFlowCheckHost,
): SemanticDiagnostic[] {
  host.checkBlock(stmt.body, scope.child());
  return [];
}
