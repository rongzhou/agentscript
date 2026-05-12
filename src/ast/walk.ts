import type { Expr } from "./types.js";

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

export function memberRootName(expr: Extract<Expr, { kind: "MemberExpr" }>): string | undefined {
  let current: Expr = expr.object;
  while (current.kind === "MemberExpr") {
    current = current.object;
  }
  return current.kind === "IdentifierExpr" ? current.name : undefined;
}
