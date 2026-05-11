import type { ConfigDecl, ConfigKey, GenerateExpr, SourceRange } from "../ast/types.js";
import { MODEL_CONFIG_KEY, isStringConfigKey } from "../language/config.js";
import { errorDiagnostic, type SemanticDiagnostic } from "./diagnostics.js";
import type { SemanticScope } from "./scope.js";

export function checkConfigDeclaration(config: ConfigDecl, scope: SemanticScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  scope.defineConfig(config.key);

  switch (config.key) {
    case MODEL_CONFIG_KEY: {
      if (config.value.kind !== "IdentifierExpr") {
        diagnostics.push(error("INVALID_CONFIG", "model must reference an imported llm name", config.value.range));
        return diagnostics;
      }
      const binding = scope.resolve(config.value.name);
      if (!binding) {
        diagnostics.push(error("UNKNOWN_MODEL", `Unknown model import '${config.value.name}'`, config.value.range));
      } else if (binding.kind !== "llm") {
        diagnostics.push(error("INVALID_MODEL", `model must reference an imported llm`, config.value.range));
      }
      return diagnostics;
    }
  }

  if (isStringConfigKey(config.key) && config.value.kind !== "StringExpr") {
    diagnostics.push(error("INVALID_CONFIG", `${config.key} must be a string`, config.value.range));
  }
  return diagnostics;
}

export function checkGenerateRequiredConfig(
  key: ConfigKey,
  expr: GenerateExpr,
  scope: SemanticScope,
): SemanticDiagnostic[] {
  if (scope.hasConfig(key)) {
    return [];
  }
  return [error("MISSING_GENERATE_CONFIG", `generate requires ${key} in the current scope`, expr.range)];
}

function error(code: string, message: string, range: SourceRange): SemanticDiagnostic {
  return errorDiagnostic(code, message, range);
}
