import type { Expr, Stmt } from "../ast/types.js";
import { childExpressions } from "../ast/walk.js";
import { isEffectfulMemoryMethod } from "../language/memory.js";
import { isEffectfulToolCall } from "../language/tools.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";
import type { SemanticScope } from "./scope.js";
import { memberRootName } from "./traverse.js";

export function blockEndsWithExpression(statements: Stmt[]): boolean {
  return statements.length > 0 && statements[statements.length - 1]?.kind === "ExprStmt";
}

export function checkParallelForBodyRules(statements: Stmt[], scope: SemanticScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const stmt of statements) {
    diagnostics.push(...checkParallelForStatementRules(stmt, scope));
  }

  return diagnostics;
}

function checkParallelForStatementRules(stmt: Stmt, scope: SemanticScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  switch (stmt.kind) {
    case "AssignStmt":
      diagnostics.push(...checkAssignmentTargetRules(stmt.target, scope));
      diagnostics.push(...checkParallelForExpressionRules(stmt.value, scope));
      break;
    case "ConfigDecl":
      diagnostics.push(...checkParallelForExpressionRules(stmt.value, scope));
      break;
    case "UseStmt":
      diagnostics.push(...checkParallelForExpressionRules(stmt.value, scope));
      break;
    case "ExprStmt":
      diagnostics.push(...checkParallelForExpressionRules(stmt.expr, scope));
      break;
    case "IfStmt":
      diagnostics.push(...checkParallelForExpressionRules(stmt.condition, scope));
      diagnostics.push(...checkParallelForBodyRules(stmt.thenBody, scope.child()));
      diagnostics.push(...checkParallelForBodyRules(stmt.elseBody ?? [], scope.child()));
      break;
    case "ForInStmt": {
      diagnostics.push(...checkParallelForExpressionRules(stmt.iterable, scope));
      const child = scope.child();
      void child.define(stmt.itemName, { kind: "local", range: stmt.itemRange });
      diagnostics.push(...checkParallelForBodyRules(stmt.body, child));
      break;
    }
    case "LoopUntilStmt":
      diagnostics.push(...checkParallelForExpressionRules(stmt.condition, scope));
      diagnostics.push(...checkParallelForBodyRules(stmt.body, scope.child()));
      break;
    case "RepeatStmt":
      diagnostics.push(...checkParallelForBodyRules(stmt.body, scope.child()));
      break;
    case "ReturnStmt":
      diagnostics.push(...checkParallelForExpressionRules(stmt.value, scope));
      break;
  }

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
    return checkParallelForExpressionRules(target.object, scope);
  }

  return checkParallelForExpressionRules(target, scope);
}

function checkParallelForExpressionRules(expr: Expr, scope: SemanticScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  if (expr.kind === "CallExpr") {
    diagnostics.push(...checkCallRules(expr.callee, scope));
    diagnostics.push(...checkParallelForExpressionRules(expr.callee, scope));
    for (const arg of expr.args) {
      diagnostics.push(...checkParallelForExpressionRules(arg, scope));
    }
    return diagnostics;
  }

  switch (expr.kind) {
    case "MemberExpr":
    case "IndexExpr":
    case "ListExpr":
    case "ObjectExpr":
    case "UnaryExpr":
    case "BinaryExpr":
    case "GenerateExpr":
      for (const child of childExpressions(expr)) {
        diagnostics.push(...checkParallelForExpressionRules(child, scope));
      }
      break;
    case "ParallelForExpr": {
      diagnostics.push(...checkParallelForExpressionRules(expr.iterable, scope));
      const child = scope.child();
      void child.define(expr.itemName, { kind: "local", range: expr.itemRange });
      diagnostics.push(...checkParallelForBodyRules(expr.body, child));
      break;
    }
    case "IdentifierExpr":
    case "StringExpr":
    case "NumberExpr":
    case "BooleanExpr":
    case "NullExpr":
    case "ShapeObjectExpr":
      break;
  }

  return diagnostics;
}

function checkCallRules(callee: Expr, scope: SemanticScope): SemanticDiagnostic[] {
  if (callee.kind !== "MemberExpr") return [];
  const root = memberRootName(callee);
  if (!root) return [];

  const binding = scope.resolve(root);
  const diagnostics: SemanticDiagnostic[] = [];

  if (binding?.kind === "memory" && isEffectfulMemoryMethod(callee.property)) {
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
  if (binding && !scope.isLocalToThisScope(root) && isEffectfulMemoryMethod(callee.property)) {
    diagnostics.push(
      error("PARALLEL_FOR_OUTER_MUTATION", `parallel for body cannot mutate outer variable '${root}'`, callee.range),
    );
  }

  return diagnostics;
}
