export interface DiagnosticBase {
  severity: "error" | "warning";
  code: string;
  message: string;
}
