import type { AssignStmt, SourceRange } from "../ast/types.js";
import { MUTABLE_BINDING_KINDS } from "../language/bindings.js";
import { errorDiagnostic, type SemanticDiagnostic } from "./diagnostics.js";
import type { SemanticScope } from "./scope.js";

export function collectAssignmentDiagnostics(stmt: AssignStmt, scope: SemanticScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  if (stmt.target.kind === "IdentifierExpr") {
    const existing = scope.resolve(stmt.target.name);
    if (existing && !MUTABLE_BINDING_KINDS.has(existing.kind)) {
      diagnostics.push(
        error(
          "IMMUTABLE_ASSIGNMENT",
          `Cannot assign to immutable ${existing.kind} binding '${stmt.target.name}'`,
          stmt.target.range,
        ),
      );
      return diagnostics;
    }
    if (!existing && !scope.isLocalToThisScope(stmt.target.name)) {
      void scope.define(stmt.target.name, { kind: "local", range: stmt.target.range });
    }
    return diagnostics;
  }

  if (stmt.target.kind === "MemberExpr") {
    return diagnostics;
  }

  diagnostics.push(
    error(
      "INVALID_ASSIGNMENT_TARGET",
      "Assignment target must be an identifier or member expression",
      stmt.target.range,
    ),
  );
  return diagnostics;
}

function error(code: string, message: string, range: SourceRange): SemanticDiagnostic {
  return errorDiagnostic(code, message, range);
}
