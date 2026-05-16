import type { AgentSpec, AgentSpecDraft } from "../spec/types.js";
import { checkBindings } from "./binding-check.js";
import { checkContext } from "./context-check.js";
import { type SpecDiagnostic, type ValidateResult, okFromDiagnostics } from "./helpers.js";
import { checkPattern } from "./pattern-check.js";
import { checkReact } from "./react-check.js";
import { checkReferences } from "./reference-check.js";
import { checkSchema } from "./schema-check.js";
import { checkTypes } from "./type-check.js";

export type { SpecDiagnostic, ValidateResult } from "./helpers.js";

type TypedValidateResult =
  | { ok: true; spec: AgentSpec; diagnostics: SpecDiagnostic[] }
  | { ok: false; diagnostics: SpecDiagnostic[] };

export function validateSpec(spec: AgentSpecDraft): ValidateResult {
  const diagnostics: SpecDiagnostic[] = [
    ...checkPattern(spec),
    ...checkSchema(spec),
    ...checkTypes(spec),
    ...checkBindings(spec),
    ...checkReferences(spec),
    ...checkContext(spec),
    ...checkReact(spec),
  ];
  return { ok: okFromDiagnostics(diagnostics), diagnostics };
}

export function validateTypedSpec(spec: AgentSpecDraft): TypedValidateResult {
  const validation = validateSpec(spec);
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };
  return { ok: true, spec: validatedAgentSpec(spec), diagnostics: validation.diagnostics };
}

function validatedAgentSpec(spec: AgentSpecDraft): AgentSpec {
  return spec as unknown as AgentSpec;
}
