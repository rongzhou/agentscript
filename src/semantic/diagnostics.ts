import type { SourceRange } from "../ast/types.js";

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
    .map((diagnostic) => {
      const { line, column } = diagnostic.range.start;
      return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} at ${line}:${column}: ${diagnostic.message}`;
    })
    .join("\n");
}
