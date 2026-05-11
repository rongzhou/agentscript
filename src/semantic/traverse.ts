import type { Expr, MemberExpr, SourceRange, Stmt } from "../ast/types.js";
import { walkExpression, walkStatement } from "../ast/walk.js";

export interface IdentifierUse {
  name: string;
  range: SourceRange;
}

export function identifiersInExpression(expr: Expr): IdentifierUse[] {
  return identifiersInExpressionWithOptions(expr);
}

export function identifiersInExpressionShallowScopes(expr: Expr): IdentifierUse[] {
  return identifiersInExpressionWithOptions(expr, false);
}

function identifiersInExpressionWithOptions(expr: Expr, enterNestedScope = true): IdentifierUse[] {
  const identifiers: IdentifierUse[] = [];
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "IdentifierExpr") {
        identifiers.push({ name: value.name, range: value.range });
      }
    },
    enterNestedScope,
  });
  return identifiers;
}

export function identifiersInStatement(stmt: Stmt): IdentifierUse[] {
  const identifiers: IdentifierUse[] = [];
  walkStatement(stmt, {
    enterExpr(value) {
      if (value.kind === "IdentifierExpr") {
        identifiers.push({ name: value.name, range: value.range });
      }
    },
  });
  return identifiers;
}

export function containsCallExpression(expr: Expr): boolean {
  return containsCallExpressionWithOptions(expr);
}

export function containsCallExpressionShallowScopes(expr: Expr): boolean {
  return containsCallExpressionWithOptions(expr, false);
}

function containsCallExpressionWithOptions(expr: Expr, enterNestedScope = true): boolean {
  let containsCall = false;
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "CallExpr" || value.kind === "GenerateExpr" || value.kind === "ParallelForExpr") {
        containsCall = true;
      }
    },
    enterNestedScope,
  });
  return containsCall;
}

export function memberRootName(expr: MemberExpr): string | undefined {
  let current: Expr = expr.object;
  while (current.kind === "MemberExpr") {
    current = current.object;
  }
  return current.kind === "IdentifierExpr" ? current.name : undefined;
}
