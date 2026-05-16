import type { GenerateExpr } from "../ast/types.js";
import { invalidGenerateOptionValue, isGenerateOptionKey } from "../language/generate-options.js";
import { collectBudgetDiagnostics } from "./budget.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export function collectGenerateOptionDiagnostics(expr: GenerateExpr): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  let hasInput = false;
  const seen = new Set<string>();

  if (expr.options.maxOutput) {
    diagnostics.push(...collectGenerateMaxOutputDiagnostics(expr));
  }

  for (const property of expr.options.properties) {
    const invalidValue = invalidGenerateOptionValue(property.key, property.value);

    if (seen.has(property.key)) {
      diagnostics.push(
        error("DUPLICATE_GENERATE_OPTION", `Duplicate generate option '${property.key}'`, property.range),
      );
    }
    seen.add(property.key);

    if (property.key === "input") {
      hasInput = true;
    } else if (!isGenerateOptionKey(property.key)) {
      diagnostics.push(error("UNKNOWN_GENERATE_OPTION", `Unknown generate option '${property.key}'`, property.range));
    }

    if (invalidValue) {
      diagnostics.push(error(invalidValue.code, invalidValue.message, property.value.range));
    }
  }

  if (!hasInput) {
    diagnostics.push(
      error("INVALID_GENERATE_INPUT", "generate object argument requires an input field", expr.options.range),
    );
  }

  return diagnostics;
}

function collectGenerateMaxOutputDiagnostics(expr: GenerateExpr): SemanticDiagnostic[] {
  return collectBudgetDiagnostics(expr.options.maxOutput, expr.options.maxOutputRange ?? expr.options.range, {
    invalidAmountCode: "INVALID_GENERATE_MAX_OUTPUT",
    invalidAmountMessage: "generate max_output must be a positive budget",
    invalidUnitCode: "INVALID_GENERATE_MAX_OUTPUT_UNIT",
    invalidUnitMessage: "generate max_output unit must be omitted or 'k'",
  });
}
