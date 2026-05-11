import type { Expr, MemberExpr, SourceRange, Stmt } from "../ast/types.js";

export interface IdentifierUse {
  name: string;
  range: SourceRange;
}

export function identifiersInExpression(expr: Expr): IdentifierUse[] {
  const identifiers: IdentifierUse[] = [];
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "IdentifierExpr") {
        identifiers.push({ name: value.name, range: value.range });
      }
    },
  });
  return identifiers;
}

export function identifiersInExpressionShallowScopes(expr: Expr): IdentifierUse[] {
  const identifiers: IdentifierUse[] = [];
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "IdentifierExpr") {
        identifiers.push({ name: value.name, range: value.range });
      }
    },
    enterNestedScope: false,
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
  let containsCall = false;
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "CallExpr" || value.kind === "GenerateExpr" || value.kind === "ParallelForExpr") {
        containsCall = true;
      }
    },
  });
  return containsCall;
}

export function containsCallExpressionShallowScopes(expr: Expr): boolean {
  let containsCall = false;
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "CallExpr" || value.kind === "GenerateExpr" || value.kind === "ParallelForExpr") {
        containsCall = true;
      }
    },
    enterNestedScope: false,
  });
  return containsCall;
}

export interface AstVisitor {
  enterExpr?: (expr: Expr) => void;
  enterStmt?: (stmt: Stmt) => void;
  enterNestedScope?: boolean;
}

export function walkExpression(expr: Expr, visitor: AstVisitor): void {
  visitor.enterExpr?.(expr);
  if (expr.kind === "ParallelForExpr") {
    walkExpression(expr.iterable, visitor);
    if (visitor.enterNestedScope === false) {
      return;
    }
    for (const stmt of expr.body) {
      walkStatement(stmt, visitor);
    }
    return;
  }
  for (const child of childExpressions(expr)) {
    walkExpression(child, visitor);
  }
}

export function walkStatement(stmt: Stmt, visitor: AstVisitor): void {
  visitor.enterStmt?.(stmt);
  for (const expr of statementExpressions(stmt)) {
    walkExpression(expr, visitor);
  }
  for (const child of childStatements(stmt)) {
    walkStatement(child, visitor);
  }
}

export function statementExpressions(stmt: Stmt): Expr[] {
  switch (stmt.kind) {
    case "ConfigDecl":
      return [stmt.value];
    case "UseStmt":
      return [stmt.value];
    case "AssignStmt":
      return [stmt.target, stmt.value];
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

export function childStatements(stmt: Stmt): Stmt[] {
  switch (stmt.kind) {
    case "IfStmt":
      return [...stmt.thenBody, ...(stmt.elseBody ?? [])];
    case "ForInStmt":
    case "LoopUntilStmt":
    case "RepeatStmt":
      return stmt.body;
    case "ConfigDecl":
    case "UseStmt":
    case "AssignStmt":
    case "ExprStmt":
    case "ReturnStmt":
      return [];
  }
}

export function childExpressions(expr: Expr): Expr[] {
  switch (expr.kind) {
    case "MemberExpr":
      return [expr.object];
    case "IndexExpr":
      return [expr.object, expr.index];
    case "ListExpr":
      return expr.items;
    case "ObjectExpr":
      return expr.properties.map((property) => property.value);
    case "UnaryExpr":
      return [expr.value];
    case "BinaryExpr":
      return [expr.left, expr.right];
    case "CallExpr":
      return [expr.callee, ...expr.args];
    case "GenerateExpr":
      return expr.options.properties.map((property) => property.value);
    case "ParallelForExpr":
      return [expr.iterable];
    case "IdentifierExpr":
    case "StringExpr":
    case "NumberExpr":
    case "BooleanExpr":
    case "NullExpr":
    case "ShapeObjectExpr":
      return [];
  }
}

export function memberRootName(expr: MemberExpr): string | undefined {
  let current: Expr = expr.object;
  while (current.kind === "MemberExpr") {
    current = current.object;
  }
  return current.kind === "IdentifierExpr" ? current.name : undefined;
}
