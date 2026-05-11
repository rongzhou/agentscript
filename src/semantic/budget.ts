import type { Budget, SourceRange } from "../ast/types.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export interface BudgetDiagnosticOptions {
  invalidAmountCode?: string;
  invalidAmountMessage?: string;
  invalidUnitCode?: string;
  invalidUnitMessage?: string;
}

export function checkBudget(
  budget: Budget | undefined,
  range: SourceRange,
  options: BudgetDiagnosticOptions = {},
): SemanticDiagnostic[] {
  if (!budget) return [];
  const diagnostics: SemanticDiagnostic[] = [];
  if (budget.amount <= 0) {
    diagnostics.push(
      error(
        options.invalidAmountCode ?? "INVALID_BUDGET",
        options.invalidAmountMessage ?? "Budget amount must be greater than 0",
        range,
      ),
    );
  }
  if (budget.unit !== undefined && budget.unit !== "k") {
    diagnostics.push(
      error(
        options.invalidUnitCode ?? "INVALID_BUDGET_UNIT",
        options.invalidUnitMessage ?? "Budget unit must be omitted or 'k'",
        range,
      ),
    );
  }
  return diagnostics;
}
