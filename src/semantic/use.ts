import type { Expr, SourceRange, UseStmt } from "../ast/types.js";
import { childExpressions } from "../ast/walk.js";
import { NON_CONTEXT_BINDING_KINDS } from "../language/bindings.js";
import { collectBudgetDiagnostics } from "./budget.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";
import type { Binding } from "./scope.js";

interface UseScope {
  resolve(name: string): Binding | undefined;
}

const RESERVED_CONTEXT_LABELS = new Set(["system", "assistant", "tool", "developer"]);

export function collectAgentUseDiagnostics(stmt: UseStmt, scope: UseScope): SemanticDiagnostic[] {
  const valueFacts = collectUseValueFacts(stmt.value);
  return [...checkCommonUseRules(stmt, scope, valueFacts), ...checkAgentLevelUseValue(valueFacts, scope)];
}

export function collectFunctionUseDiagnostics(stmt: UseStmt, scope: UseScope): SemanticDiagnostic[] {
  return checkCommonUseRules(stmt, scope, collectUseValueFacts(stmt.value));
}

function checkCommonUseRules(stmt: UseStmt, scope: UseScope, valueFacts: UseValueFacts): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  diagnostics.push(...checkUseValue(valueFacts, scope));
  if (valueFacts.containsCall) {
    diagnostics.push(
      error(
        "INVALID_USE_CALL",
        "use declarations cannot contain call expressions; assign the call result first, then use the variable",
        stmt.value.range,
      ),
    );
  }
  diagnostics.push(...collectBudgetDiagnostics(stmt.budget, stmt.range));
  if (stmt.label && RESERVED_CONTEXT_LABELS.has(stmt.label)) {
    diagnostics.push(error("RESERVED_CONTEXT_LABEL", `Context label '${stmt.label}' is reserved`, stmt.range));
  }

  return diagnostics;
}

function checkAgentLevelUseValue(facts: UseValueFacts, scope: UseScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  for (const identifier of facts.identifiers) {
    const binding = scope.resolve(identifier.name);
    if (binding && binding.kind !== "file") {
      diagnostics.push(
        error("INVALID_AGENT_USE", "Agent-level use may only reference imported file bindings", identifier.range),
      );
    }
  }
  return diagnostics;
}

interface UseValueFacts {
  containsCall: boolean;
  identifiers: IdentifierUse[];
}

interface IdentifierUse {
  name: string;
  range: SourceRange;
}

function checkUseValue(facts: UseValueFacts, scope: UseScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  for (const identifier of facts.identifiers) {
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

function collectUseValueFacts(expr: Expr): UseValueFacts {
  const facts: UseValueFacts = { containsCall: false, identifiers: [] };
  collectUseValueFactsInto(expr, facts);
  return facts;
}

function collectUseValueFactsInto(expr: Expr, facts: UseValueFacts): void {
  if (expr.kind === "IdentifierExpr") {
    facts.identifiers.push({ name: expr.name, range: expr.range });
  }
  if (expr.kind === "CallExpr" || expr.kind === "GenerateExpr" || expr.kind === "ParallelForExpr") {
    facts.containsCall = true;
  }
  for (const child of childExpressions(expr)) {
    collectUseValueFactsInto(child, facts);
  }
}
