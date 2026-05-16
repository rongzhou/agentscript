import type { AgentSpec } from "../spec/types.js";
import type { AgentSpecDraft } from "../spec/schema.js";
import { checkBindings } from "./binding-check.js";
import { checkContext } from "./context-check.js";
import { type SpecDiagnostic, type ValidateResult, okFromDiagnostics } from "./diagnostics.js";
import { checkPattern } from "./pattern-check.js";
import { checkReact } from "./react-check.js";
import { checkReferences } from "./reference-check.js";
import { checkSchema } from "./schema-check.js";
import { checkTypes } from "./type-check.js";

export type { SpecDiagnostic, ValidateResult } from "./diagnostics.js";

export function validateSpec(spec: AgentSpecDraft): ValidateResult {
  const diagnostics: SpecDiagnostic[] = [
    ...checkSchema(spec),
    ...checkPattern(spec),
    ...checkTypes(spec),
    ...checkBindings(spec),
    ...checkReferences(spec),
    ...checkContext(spec),
    ...checkReact(spec),
  ];
  return { ok: okFromDiagnostics(diagnostics), diagnostics };
}

export function assertValidAgentSpec(spec: AgentSpecDraft): AgentSpec {
  const result = validateSpec(spec);
  if (!result.ok) {
    throw new ArchitectValidationError(result.diagnostics);
  }
  return spec as unknown as AgentSpec;
}

export class ArchitectValidationError extends Error {
  constructor(readonly diagnostics: SpecDiagnostic[]) {
    super("AgentSpec is not valid");
    this.name = "ArchitectValidationError";
  }
}
