import type { UseStmt } from "../ast/types.js";
import { NON_CONTEXT_BINDING_KINDS } from "../language/bindings.js";
import { checkBudget } from "./budget.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";
import type { Binding } from "./scope.js";
import { containsCallExpression, identifiersInExpression } from "./traverse.js";

interface UseScope {
  resolve(name: string): Binding | undefined;
}

const RESERVED_CONTEXT_LABELS = new Set(["system", "assistant", "tool", "developer"]);

export function checkAgentUse(stmt: UseStmt, scope: UseScope): SemanticDiagnostic[] {
  return checkUseRules(stmt, scope, { agentLevel: true });
}

export function checkFunctionUse(stmt: UseStmt, scope: UseScope): SemanticDiagnostic[] {
  return checkUseRules(stmt, scope, { agentLevel: false });
}

function checkUseRules(stmt: UseStmt, scope: UseScope, options: { agentLevel: boolean }): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  diagnostics.push(...checkUseValue(stmt, scope));
  if (containsCallExpression(stmt.value, { shallow: true })) {
    diagnostics.push(
      error(
        "INVALID_USE_CALL",
        "use declarations cannot contain call expressions; assign the call result first, then use the variable",
        stmt.value.range,
      ),
    );
  }
  if (options.agentLevel) {
    diagnostics.push(...checkAgentLevelUseValue(stmt, scope));
  }
  diagnostics.push(...checkBudget(stmt.budget, stmt.range));
  if (stmt.label && RESERVED_CONTEXT_LABELS.has(stmt.label)) {
    diagnostics.push(error("RESERVED_CONTEXT_LABEL", `Context label '${stmt.label}' is reserved`, stmt.range));
  }

  return diagnostics;
}

function checkUseValue(stmt: UseStmt, scope: UseScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  for (const identifier of identifiersInExpression(stmt.value, { shallow: true })) {
    const binding = scope.resolve(identifier.name);
    if (binding && NON_CONTEXT_BINDING_KINDS.has(binding.kind)) {
      diagnostics.push(
        error(
          "INVALID_USE_RESOURCE",
          `Resource '${identifier.name}' cannot be used as prompt context`,
          identifier.range,
        ),
      );
    }
  }
  return diagnostics;
}

function checkAgentLevelUseValue(stmt: UseStmt, scope: UseScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  for (const identifier of identifiersInExpression(stmt.value, { shallow: true })) {
    const binding = scope.resolve(identifier.name);
    if (binding && binding.kind !== "file") {
      diagnostics.push(
        error("INVALID_AGENT_USE", "Agent-level use may only reference imported file bindings", identifier.range),
      );
    }
  }
  return diagnostics;
}
