import type { SourceRange } from "../ast/types.js";
import { formatSourceRangeStart } from "../utils/location.js";

export type DiagnosticSeverity = "error" | "warning";

export interface SemanticDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  range: SourceRange;
}

export interface SemanticResult {
  diagnostics: SemanticDiagnostic[];
}

export function errorDiagnostic(code: string, message: string, range: SourceRange): SemanticDiagnostic {
  return { severity: "error", code, message, range };
}

export class SemanticError extends Error {
  readonly diagnostics: SemanticDiagnostic[];

  constructor(diagnostics: SemanticDiagnostic[]) {
    super(formatSemanticDiagnostics(diagnostics));
    this.name = "SemanticError";
    this.diagnostics = diagnostics;
  }
}

export function formatSemanticDiagnostics(diagnostics: SemanticDiagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} at ${formatSourceRangeStart(diagnostic.range)}: ${diagnostic.message}`,
    )
    .join("\n");
}
