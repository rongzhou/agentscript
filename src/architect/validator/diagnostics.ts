export interface SpecDiagnostic {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
  suggested_fix?: string;
}

export interface ValidateResult {
  ok: boolean;
  diagnostics: SpecDiagnostic[];
}

export function error(code: string, path: string, message: string, suggested_fix?: string): SpecDiagnostic {
  return suggested_fix
    ? { severity: "error", code, path, message, suggested_fix }
    : { severity: "error", code, path, message };
}

export function okFromDiagnostics(diagnostics: SpecDiagnostic[]): boolean {
  return !diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
