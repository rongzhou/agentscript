import { parse } from "../../parser/parser.js";
import { analyze } from "../../semantic/analyzer.js";
import type { SemanticDiagnostic } from "../../semantic/diagnostics.js";
import type { SpecDiagnostic } from "../validator/index.js";

export interface ArchitectAnalysisResult {
  ok: boolean;
  diagnostics: SpecDiagnostic[];
}

export function analyzeSource(source: string): ArchitectAnalysisResult {
  try {
    const result = analyze(parse(source));
    const diagnostics = result.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map(toSpecDiagnostic);
    return { ok: diagnostics.length === 0, diagnostics };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "parse_error",
          path: "",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function toSpecDiagnostic(diagnostic: SemanticDiagnostic): SpecDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    path: `source:${diagnostic.range.start.line}:${diagnostic.range.start.column}`,
    range: diagnostic.range,
    message: diagnostic.message,
  };
}
