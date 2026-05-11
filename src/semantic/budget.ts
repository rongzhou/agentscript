import type { Budget, SourceRange } from "../ast/types.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export function checkBudget(budget: Budget | undefined, range: SourceRange): SemanticDiagnostic[] {
  if (!budget) return [];
  const diagnostics: SemanticDiagnostic[] = [];
  if (budget.amount <= 0) {
    diagnostics.push(error("INVALID_BUDGET", "Budget amount must be greater than 0", range));
  }
  if (budget.unit !== undefined && budget.unit !== "k") {
    diagnostics.push(error("INVALID_BUDGET_UNIT", "Budget unit must be omitted or 'k'", range));
  }
  return diagnostics;
}
