import { analyzeSource } from "./compiler/analyze.js";
import { compileSpec } from "./compiler/index.js";
import type { AgentSpecDraft } from "./spec/types.js";
import type { SpecDiagnostic } from "./validator/index.js";

export type ArchitectPipelineResult =
  | { ok: true; stage: "ok"; source: string }
  | { ok: false; stage: "validate"; diagnostics: SpecDiagnostic[] }
  | { ok: false; stage: "compile"; diagnostics: SpecDiagnostic[] }
  | { ok: false; stage: "analyze"; diagnostics: SpecDiagnostic[] };

export function buildAgentScript(spec: AgentSpecDraft): ArchitectPipelineResult {
  const compiled = compileSpec(spec);
  if (!compiled.ok) {
    return { ok: false, stage: "validate", diagnostics: compiled.diagnostics };
  }
  const analysis = analyzeSource(compiled.source);
  if (!analysis.ok) {
    return { ok: false, stage: "analyze", diagnostics: analysis.diagnostics };
  }
  return { ok: true, stage: "ok", source: compiled.source };
}
