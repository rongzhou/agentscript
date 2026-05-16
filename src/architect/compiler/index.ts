import { analyzeSource } from "./analyze.js";
import type { AgentSpecDraft } from "../spec/types.js";
import { validateTypedSpec, type SpecDiagnostic } from "../validator/index.js";
import { emitLinear } from "./emit-linear.js";
import { emitReact } from "./emit-react.js";

export type CompileResult =
  | { ok: true; source: string }
  | { ok: false; code: "validation_required"; diagnostics: SpecDiagnostic[] };

export type ArchitectPipelineResult =
  | { ok: true; stage: "ok"; source: string }
  | { ok: false; stage: "validate"; diagnostics: SpecDiagnostic[] }
  | { ok: false; stage: "analyze"; diagnostics: SpecDiagnostic[] };

export function compileSpec(spec: AgentSpecDraft): CompileResult {
  const validation = validateTypedSpec(spec);
  if (!validation.ok) {
    return { ok: false, code: "validation_required", diagnostics: validation.diagnostics };
  }
  const typed = validation.spec;
  if (typed.pattern === "react") {
    return { ok: true, source: emitReact(typed) };
  }
  return { ok: true, source: emitLinear(typed) };
}

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
