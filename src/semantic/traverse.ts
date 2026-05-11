import type { Expr, SourceRange } from "../ast/types.js";
import { walkExpression } from "../ast/walk.js";

export interface IdentifierUse {
  name: string;
  range: SourceRange;
}

export function identifiersInExpression(expr: Expr, options: { shallow?: boolean } = {}): IdentifierUse[] {
  const identifiers: IdentifierUse[] = [];
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "IdentifierExpr") {
        identifiers.push({ name: value.name, range: value.range });
      }
    },
    enterNestedScope: options.shallow ? false : undefined,
  });
  return identifiers;
}

export function containsCallExpression(expr: Expr, options: { shallow?: boolean } = {}): boolean {
  let containsCall = false;
  walkExpression(expr, {
    enterExpr(value) {
      if (value.kind === "CallExpr" || value.kind === "GenerateExpr" || value.kind === "ParallelForExpr") {
        containsCall = true;
      }
    },
    enterNestedScope: options.shallow ? false : undefined,
  });
  return containsCall;
}
