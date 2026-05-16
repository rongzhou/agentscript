import type { AgentSpec } from "../spec/types.js";
import type { AgentSpecDraft } from "../spec/schema.js";
import { validateSpec, type SpecDiagnostic } from "../validator/index.js";
import { emitLinear } from "./emit-linear.js";
import { emitReact } from "./emit-react.js";

export type CompileResult =
  | { ok: true; source: string }
  | { ok: false; code: "validation_required"; diagnostics: SpecDiagnostic[] };

export function compileSpec(spec: AgentSpecDraft): CompileResult {
  const validation = validateSpec(spec);
  if (!validation.ok) {
    return { ok: false, code: "validation_required", diagnostics: validation.diagnostics };
  }
  const typed = spec as unknown as AgentSpec;
  if (typed.pattern === "react") {
    return { ok: true, source: emitReact(typed) };
  }
  return { ok: true, source: emitLinear(typed) };
}
