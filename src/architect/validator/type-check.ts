import { isAgentSpecType } from "../spec/types.js";
import type { AgentSpecDraft } from "../spec/types.js";
import { entriesOf, error, isRecord, outputFields, patternOf, pointer, type SpecDiagnostic } from "./helpers.js";

export function checkTypes(spec: AgentSpecDraft): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  for (const [name, input] of entriesOf(spec.inputs)) {
    if (isRecord(input)) checkType(input.type, pointer("inputs", name, "type"), diagnostics);
  }
  const fields = outputFields(spec.output);
  for (const [name, field] of entriesOf(fields)) {
    if (isRecord(field)) checkType(field.type, pointer("output", "fields", name, "type"), diagnostics);
  }
  if (patternOf(spec) === "react" && isRecord(spec.react) && isRecord(spec.react.reason)) {
    const reasonFields = outputFields(spec.react.reason.output);
    for (const [name, field] of entriesOf(reasonFields)) {
      if (isRecord(field))
        checkType(field.type, pointer("react", "reason", "output", "fields", name, "type"), diagnostics);
    }
  }
  return diagnostics;
}

function checkType(value: unknown, path: string, diagnostics: SpecDiagnostic[]): void {
  if (value === undefined) return;
  if (typeof value !== "string") return;
  if (!isAgentSpecType(value)) {
    diagnostics.push(error("UNSUPPORTED_TYPE", path, `Unsupported AgentSpec type '${value}'.`));
  }
}
