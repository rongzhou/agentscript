import type { Expr, ObjectProperty } from "./types.js";

export function formatExpressionSource(expr: Expr): string {
  switch (expr.kind) {
    case "IdentifierExpr":
      return expr.name;
    case "StringExpr":
      return JSON.stringify(expr.value);
    case "NumberExpr":
      return expr.raw;
    case "BooleanExpr":
      return String(expr.value);
    case "NullExpr":
      return "none";
    case "ListExpr":
      return `[${formatItems(expr.items)}]`;
    case "ObjectExpr":
      return `{ ${formatProperties(expr.properties)} }`;
    case "ContractObjectExpr":
      return "{ contract }";
    case "MemberExpr":
      return `${formatExpressionSource(expr.object)}.${expr.property}`;
    case "IndexExpr":
      return `${formatExpressionSource(expr.object)}[${formatExpressionSource(expr.index)}]`;
    case "UnaryExpr":
      return `${expr.operator} ${formatExpressionSource(expr.value)}`;
    case "BinaryExpr":
      return `${formatExpressionSource(expr.left)} ${expr.operator} ${formatExpressionSource(expr.right)}`;
    case "CallExpr":
      return `${formatExpressionSource(expr.callee)}(${formatItems(expr.args)})`;
    case "GenerateExpr":
      return `generate({ ${formatGenerateOptions(expr.options)} })`;
    case "ParallelForExpr":
      return `parallel for ${expr.item.name} in ${formatExpressionSource(expr.iterable)} max ${expr.maxIterations}`;
  }
}

function formatItems(items: Expr[]): string {
  return items.map(formatExpressionSource).join(", ");
}

function formatProperties(properties: ObjectProperty[]): string {
  return properties.map((p) => `${p.key}: ${formatExpressionSource(p.value)}`).join(", ");
}

function formatGenerateOptions(options: { properties: ObjectProperty[] }): string {
  return options.properties.map((p) => `${p.key}: ${formatExpressionSource(p.value)}`).join(", ");
}
