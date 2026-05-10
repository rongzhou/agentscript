import type { Stmt } from "../ast/types.js";
import { uriScheme } from "../runtime/uri.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

interface BindingLike {
  kind: string;
  uri?: string;
}

interface ParallelForScope {
  resolve(name: string): BindingLike | undefined;
  isLocalToThisScope(name: string): boolean;
}

const EFFECTFUL_TOOL_METHODS = new Set(["write", "patch", "delete", "post", "put"]);
const EFFECTFUL_TOOL_SCHEMES = new Set(["mcp", "npm", "node"]);

export function blockEndsWithExpression(statements: Stmt[]): boolean {
  return statements.length > 0 && statements[statements.length - 1]?.kind === "ExprStmt";
}

export function checkParallelForBodyRules(statements: Stmt[], scope: ParallelForScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  for (const stmt of statements) {
    if (stmt.kind === "AssignStmt" && stmt.target.kind === "IdentifierExpr") {
      const binding = scope.resolve(stmt.target.name);
      if (binding && !scope.isLocalToThisScope(stmt.target.name)) {
        diagnostics.push(
          error(
            "PARALLEL_FOR_OUTER_ASSIGNMENT",
            `parallel for body cannot assign to outer variable '${stmt.target.name}'`,
            stmt.target.range,
          ),
        );
      }
    }

    if (
      stmt.kind === "ExprStmt" &&
      stmt.expr.kind === "CallExpr" &&
      stmt.expr.callee.kind === "MemberExpr" &&
      stmt.expr.callee.object.kind === "IdentifierExpr"
    ) {
      const root = stmt.expr.callee.object.name;
      const binding = scope.resolve(root);
      if (binding?.kind === "memory" && stmt.expr.callee.property === "add") {
        diagnostics.push(
          error(
            "PARALLEL_FOR_EFFECTFUL_CALL",
            `effectful operation '${root}.${stmt.expr.callee.property}' is not allowed inside parallel for`,
            stmt.expr.callee.range,
          ),
        );
      }
      if (binding?.kind === "tool" && isEffectfulToolCall(binding, stmt.expr.callee.property)) {
        diagnostics.push(
          error(
            "PARALLEL_FOR_EFFECTFUL_CALL",
            `effectful operation '${root}.${stmt.expr.callee.property}' is not allowed inside parallel for`,
            stmt.expr.callee.range,
          ),
        );
      }
      if (binding && !scope.isLocalToThisScope(root) && stmt.expr.callee.property === "add") {
        diagnostics.push(
          error(
            "PARALLEL_FOR_OUTER_MUTATION",
            `parallel for body cannot mutate outer variable '${root}'`,
            stmt.expr.callee.range,
          ),
        );
      }
    }
  }

  return diagnostics;
}

function isEffectfulToolCall(binding: BindingLike, method: string): boolean {
  if (binding.uri && EFFECTFUL_TOOL_SCHEMES.has(uriScheme(binding.uri))) return true;
  return EFFECTFUL_TOOL_METHODS.has(method);
}
