import type { Expr, ItemBinding, Stmt } from "../ast/types.js";
import { childExpressions, statementExpressions } from "../ast/walk.js";
import { SemanticScope } from "./scope.js";

export interface ScopedAstVisitor {
  enterExpression?: (expr: Expr, scope: SemanticScope) => void;
  enterStatement?: (stmt: Stmt, scope: SemanticScope) => void;
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
  visitor.enterStatement?.(stmt, scope);
  for (const expr of statementExpressions(stmt)) {
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
}

function walkExpressionInScope(expr: Expr, scope: SemanticScope, visitor: ScopedAstVisitor): void {
  visitor.enterExpression?.(expr, scope);
  if (expr.kind === "ParallelForExpr") {
    walkExpressionInScope(expr.iterable, scope, visitor);
    walkStatementsInScope(expr.body, scopeWithItemBinding(scope, expr.item), visitor);
    return;
  }
  for (const child of childExpressions(expr)) {
    walkExpressionInScope(child, scope, visitor);
  }
}
