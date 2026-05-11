import type { GenerateExpr } from "../ast/types.js";
import { getGenerateOptionSpec, isGenerateOptionKey } from "../language/generate-options.js";
import { checkBudget } from "./budget.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export function checkGenerateOptions(expr: GenerateExpr): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  let hasInput = false;
  const seen = new Set<string>();

  for (const property of expr.options.properties) {
    if (seen.has(property.key)) {
      diagnostics.push(
        error("DUPLICATE_GENERATE_OPTION", `Duplicate generate option '${property.key}'`, property.range),
      );
    }
    seen.add(property.key);

    const spec = getGenerateOptionSpec(property.key);

    if (property.key === "input") {
      hasInput = true;
    } else if (property.key === "max_output") {
      diagnostics.push(...checkBudget(expr.options.maxOutput, property.value.range));
    } else if (!isGenerateOptionKey(property.key)) {
      diagnostics.push(error("UNKNOWN_GENERATE_OPTION", `Unknown generate option '${property.key}'`, property.range));
    }

    if (spec?.isValid && !spec.isValid(property.value, expr.options.maxOutput)) {
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
