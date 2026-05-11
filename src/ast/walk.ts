import type { Expr, Stmt } from "./types.js";

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
