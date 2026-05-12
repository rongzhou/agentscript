import type { Expr, ItemBinding, Stmt } from "../ast/types.js";
import { childExpressions } from "../ast/walk.js";
import { SemanticScope } from "./scope.js";

export interface ScopedAstVisitor {
  afterStatement?: (stmt: Stmt, scope: SemanticScope) => void;
  enterExpression?: (expr: Expr, scope: SemanticScope) => false | void;
  enterStatement?: (stmt: Stmt, scope: SemanticScope) => false | void;
}

export function scopeWithItemBinding(parent: SemanticScope, item: ItemBinding): SemanticScope {
  const child = parent.child();
  void child.define(item.name, { kind: "local", range: item.range });
  return child;
}

export function walkStatementsInScope(statements: Stmt[], scope: SemanticScope, visitor: ScopedAstVisitor): void {
  for (const stmt of statements) {
    walkStatementInScope(stmt, scope, visitor);
  }
}

function walkStatementInScope(stmt: Stmt, scope: SemanticScope, visitor: ScopedAstVisitor): void {
  if (visitor.enterStatement?.(stmt, scope) === false) {
    // Returning false skips child traversal only; statement finalization still runs.
    visitor.afterStatement?.(stmt, scope);
    return;
  }
  for (const expr of statementReadExpressions(stmt)) {
    walkExpressionInScope(expr, scope, visitor);
  }

  switch (stmt.kind) {
    case "IfStmt":
      walkStatementsInScope(stmt.thenBody, scope.child(), visitor);
      walkStatementsInScope(stmt.elseBody ?? [], scope.child(), visitor);
      break;
    case "ForInStmt":
      walkStatementsInScope(stmt.body, scopeWithItemBinding(scope, stmt.item), visitor);
      break;
    case "LoopUntilStmt":
    case "RepeatStmt":
      walkStatementsInScope(stmt.body, scope.child(), visitor);
      break;
    case "ConfigDecl":
    case "UseStmt":
    case "AssignStmt":
    case "ExprStmt":
    case "ReturnStmt":
      break;
  }
  visitor.afterStatement?.(stmt, scope);
}

function statementReadExpressions(stmt: Stmt): Expr[] {
  switch (stmt.kind) {
    case "AssignStmt":
      if (stmt.target.kind === "MemberExpr") {
        return [stmt.value, stmt.target.object];
      }
      return [stmt.value];
    case "ConfigDecl":
      return [stmt.value];
    case "UseStmt":
      return [stmt.value];
    case "ExprStmt":
      return [stmt.expr];
    case "IfStmt":
      return [stmt.condition];
    case "ForInStmt":
      return [stmt.iterable];
    case "LoopUntilStmt":
      return [stmt.condition];
    case "RepeatStmt":
      return [];
    case "ReturnStmt":
      return [stmt.value];
  }
}

export function walkExpressionInScope(expr: Expr, scope: SemanticScope, visitor: ScopedAstVisitor): void {
  if (visitor.enterExpression?.(expr, scope) === false) {
    return;
  }
  if (expr.kind === "ParallelForExpr") {
    walkExpressionInScope(expr.iterable, scope, visitor);
    walkStatementsInScope(expr.body, scopeWithItemBinding(scope, expr.item), visitor);
    return;
  }
  for (const child of childExpressions(expr)) {
    walkExpressionInScope(child, scope, visitor);
  }
}
