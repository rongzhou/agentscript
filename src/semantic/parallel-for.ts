import type { Expr, Stmt } from "../ast/types.js";
import { memberRootName } from "../ast/walk.js";
import { isEffectfulMemoryMethod } from "../language/memory.js";
import { isEffectfulToolCall } from "../language/tools.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";
import type { SemanticScope } from "./scope.js";
import { scopeWithItemBinding, walkStatementsInScope } from "./walker.js";

export function collectParallelForDiagnostics(
  expr: Extract<Expr, { kind: "ParallelForExpr" }>,
  scope: SemanticScope,
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  if (expr.maxIterations <= 0) {
    diagnostics.push(error("INVALID_PARALLEL_FOR_LIMIT", "parallel for item count must be greater than 0", expr.range));
  }
  if (!blockEndsWithExpression(expr.body)) {
    diagnostics.push(
      error("INVALID_PARALLEL_FOR_BODY", "parallel for body must end with a value expression", expr.range),
    );
  }
  diagnostics.push(...checkParallelForBodyRules(expr.body, scopeWithItemBinding(scope, expr.item)));
  return diagnostics;
}

function blockEndsWithExpression(statements: Stmt[]): boolean {
  return statements.length > 0 && statements[statements.length - 1]?.kind === "ExprStmt";
}

function checkParallelForBodyRules(statements: Stmt[], scope: SemanticScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  walkStatementsInScope(statements, scope, {
    enterStatement(stmt, currentScope) {
      if (stmt.kind === "AssignStmt") {
        diagnostics.push(...checkAssignmentTargetRules(stmt.target, currentScope));
      }
    },
    enterExpression(expr, currentScope) {
      if (expr.kind === "CallExpr") {
        diagnostics.push(...checkCallRules(expr.callee, currentScope));
      }
    },
  });

  return diagnostics;
}

function checkAssignmentTargetRules(target: Expr, scope: SemanticScope): SemanticDiagnostic[] {
  if (target.kind === "IdentifierExpr") {
    const binding = scope.resolve(target.name);
    if (binding && !scope.isLocalToThisScope(target.name)) {
      return [
        error(
          "PARALLEL_FOR_OUTER_ASSIGNMENT",
          `parallel for body cannot assign to outer variable '${target.name}'`,
          target.range,
        ),
      ];
    }
    return [];
  }

  if (target.kind === "MemberExpr") {
    const root = memberRootName(target);
    const binding = root ? scope.resolve(root) : undefined;
    if (root && binding && !scope.isLocalToThisScope(root)) {
      return [
        error("PARALLEL_FOR_OUTER_MUTATION", `parallel for body cannot mutate outer variable '${root}'`, target.range),
      ];
    }
    return [];
  }

  return [];
}

function checkCallRules(callee: Expr, scope: SemanticScope): SemanticDiagnostic[] {
  if (callee.kind !== "MemberExpr") return [];
  const root = memberRootName(callee);
  if (!root) return [];

  const binding = scope.resolve(root);
  const diagnostics: SemanticDiagnostic[] = [];

  const isEffectfulMemoryCall = binding?.kind === "memory" && isEffectfulMemoryMethod(callee.property);
  const isOuterMutationLikeCall =
    binding !== undefined &&
    (binding.kind === "local" || binding.kind === "param") &&
    !scope.isLocalToThisScope(root) &&
    callee.property === "add";
  if (isEffectfulMemoryCall) {
    diagnostics.push(
      error(
        "PARALLEL_FOR_EFFECTFUL_CALL",
        `effectful operation '${root}.${callee.property}' is not allowed inside parallel for`,
        callee.range,
      ),
    );
  }
  if (binding?.kind === "tool" && isEffectfulToolCall(callee.property, binding.uri)) {
    diagnostics.push(
      error(
        "PARALLEL_FOR_EFFECTFUL_CALL",
        `effectful operation '${root}.${callee.property}' is not allowed inside parallel for`,
        callee.range,
      ),
    );
  }
  if (isOuterMutationLikeCall) {
    diagnostics.push(
      error("PARALLEL_FOR_OUTER_MUTATION", `parallel for body cannot mutate outer variable '${root}'`, callee.range),
    );
  }

  return diagnostics;
}
