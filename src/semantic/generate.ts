import type { GenerateExpr, SourceRange } from "../ast/types.js";
import type { SemanticDiagnostic } from "./diagnostics.js";

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

    if (property.key === "input") {
      hasInput = true;
    } else if (property.key === "attempts") {
      const isPositiveInteger =
        property.value.kind === "NumberExpr" && Number.isInteger(property.value.value) && property.value.value > 0;
      if (!isPositiveInteger) {
        diagnostics.push(
          error("INVALID_GENERATE_ATTEMPTS", "generate attempts must be a positive integer", property.value.range),
        );
      }
    } else if (property.key === "max_output") {
      if (!expr.options.maxOutput || expr.options.maxOutput.amount <= 0) {
        diagnostics.push(
          error("INVALID_GENERATE_MAX_OUTPUT", "generate max_output must be a positive budget", property.value.range),
        );
      }
    } else if (property.key === "temperature") {
      if (property.value.kind !== "NumberExpr") {
        diagnostics.push(
          error("INVALID_GENERATE_TEMPERATURE", "generate temperature must be a number", property.value.range),
        );
      }
    } else if (property.key === "think") {
      const validThinkString =
        property.value.kind === "StringExpr" && ["auto", "low", "medium", "high"].includes(property.value.value);
      if (property.value.kind !== "BooleanExpr" && !validThinkString) {
        diagnostics.push(
          error(
            "INVALID_GENERATE_THINK",
            "generate think must be a boolean or one of auto, low, medium, high",
            property.value.range,
          ),
        );
      }
    } else if (property.key === "strict") {
      if (property.value.kind !== "BooleanExpr") {
        diagnostics.push(error("INVALID_GENERATE_STRICT", "generate strict must be a boolean", property.value.range));
      }
    } else if (property.key === "debug") {
      if (property.value.kind !== "BooleanExpr") {
        diagnostics.push(error("INVALID_GENERATE_DEBUG", "generate debug must be a boolean", property.value.range));
      }
    } else {
      diagnostics.push(error("UNKNOWN_GENERATE_OPTION", `Unknown generate option '${property.key}'`, property.range));
    }
  }

  if (!hasInput) {
    diagnostics.push(
      error("INVALID_GENERATE_INPUT", "generate object argument requires an input field", expr.options.range),
    );
  }

  return diagnostics;
}

function error(code: string, message: string, range: SourceRange): SemanticDiagnostic {
  return {
    severity: "error",
    code,
    message,
    range,
  };
}
