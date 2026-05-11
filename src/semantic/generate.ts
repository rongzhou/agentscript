import type { GenerateExpr } from "../ast/types.js";
import { getGenerateOptionSpec, isGenerateOptionKey } from "../language/generate-options.js";
import { checkBudget } from "./budget.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export function checkGenerateOptions(expr: GenerateExpr): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  let hasInput = false;
  const seen = new Set<string>();

  if (expr.options.maxOutput) {
    diagnostics.push(...checkGenerateMaxOutput(expr));
  }

  for (const property of expr.options.properties) {
    const spec = getGenerateOptionSpec(property.key);

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

    if (spec?.isValid && !spec.isValid(property.value)) {
      diagnostics.push(
        error(
          spec.invalidCode ?? "INVALID_GENERATE_OPTION",
          spec.invalidMessage ?? "Invalid generate option",
          property.value.range,
        ),
      );
    }
  }

  if (!hasInput) {
    diagnostics.push(
      error("INVALID_GENERATE_INPUT", "generate object argument requires an input field", expr.options.range),
    );
  }

  return diagnostics;
}

function checkGenerateMaxOutput(expr: GenerateExpr): SemanticDiagnostic[] {
  return checkBudget(expr.options.maxOutput, expr.options.maxOutputRange ?? expr.options.range, {
    invalidAmountCode: "INVALID_GENERATE_MAX_OUTPUT",
    invalidAmountMessage: "generate max_output must be a positive budget",
    invalidUnitCode: "INVALID_GENERATE_MAX_OUTPUT_UNIT",
    invalidUnitMessage: "generate max_output unit must be omitted or 'k'",
  });
}
