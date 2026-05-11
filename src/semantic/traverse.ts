import type { Expr, MemberExpr, SourceRange, Stmt } from "../ast/types.js";

export interface IdentifierUse {
  name: string;
  range: SourceRange;
}

export function identifiersInExpression(expr: Expr): IdentifierUse[] {
  switch (expr.kind) {
    case "IdentifierExpr":
      return [{ name: expr.name, range: expr.range }];
    case "ParallelForExpr":
      return [...identifiersInExpression(expr.iterable), ...expr.body.flatMap((stmt) => identifiersInStatement(stmt))];
    case "MemberExpr":
    case "IndexExpr":
    case "ListExpr":
    case "ObjectExpr":
    case "UnaryExpr":
    case "BinaryExpr":
    case "CallExpr":
    case "GenerateExpr":
      return childExpressions(expr).flatMap((child) => identifiersInExpression(child));
    case "StringExpr":
    case "NumberExpr":
    case "BooleanExpr":
    case "NullExpr":
    case "ShapeObjectExpr":
      return [];
  }
}

export function identifiersInStatement(stmt: Stmt): IdentifierUse[] {
  switch (stmt.kind) {
    case "ConfigDecl":
      return identifiersInExpression(stmt.value);
    case "UseStmt":
      return identifiersInExpression(stmt.value);
    case "AssignStmt":
      return [...identifiersInExpression(stmt.target), ...identifiersInExpression(stmt.value)];
    case "ExprStmt":
      return identifiersInExpression(stmt.expr);
    case "IfStmt":
      return [
        ...identifiersInExpression(stmt.condition),
        ...stmt.thenBody.flatMap((item) => identifiersInStatement(item)),
        ...(stmt.elseBody ?? []).flatMap((item) => identifiersInStatement(item)),
      ];
    case "ForInStmt":
      return [...identifiersInExpression(stmt.iterable), ...stmt.body.flatMap((item) => identifiersInStatement(item))];
    case "LoopUntilStmt":
      return [...identifiersInExpression(stmt.condition), ...stmt.body.flatMap((item) => identifiersInStatement(item))];
    case "RepeatStmt":
      return stmt.body.flatMap((item) => identifiersInStatement(item));
    case "ReturnStmt":
      return identifiersInExpression(stmt.value);
  }
}

export function containsCallExpression(expr: Expr): boolean {
  switch (expr.kind) {
    case "CallExpr":
      return true;
    case "GenerateExpr":
    case "ParallelForExpr":
      return true;
    case "MemberExpr":
    case "IndexExpr":
    case "ListExpr":
    case "ObjectExpr":
    case "UnaryExpr":
    case "BinaryExpr":
      return childExpressions(expr).some((child) => containsCallExpression(child));
    case "IdentifierExpr":
    case "StringExpr":
    case "NumberExpr":
    case "BooleanExpr":
    case "NullExpr":
    case "ShapeObjectExpr":
      return false;
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
