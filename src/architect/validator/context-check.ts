import type { AgentSpecDraft } from "../spec/schema.js";
import { BUDGET_RE, error, isRecord, pointer, type SpecDiagnostic } from "./helpers.js";
import { buildReferenceIndex, checkInputLocalRef } from "./reference-check.js";

export function checkContext(spec: AgentSpecDraft): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  const index = buildReferenceIndex(spec);
  if (Array.isArray(spec.model_context) && spec.model_context.length === 0) {
    diagnostics.push(error("EMPTY_MODEL_CONTEXT", "/model_context", "model_context must contain at least one entry."));
  }
  for (const [contextIndex, context] of (Array.isArray(spec.model_context) ? spec.model_context : []).entries()) {
    if (!isRecord(context)) continue;
    const source = context.source;
    const sourcePath = pointer("model_context", contextIndex, "source");
    if (typeof source === "string") {
      if (!source.startsWith("input.") && !source.startsWith("local.")) {
        diagnostics.push(
          error("INVALID_CONTEXT_SOURCE", sourcePath, "model_context source must be input.<field> or local.<name>."),
        );
      } else {
        checkInputLocalRef(source, sourcePath, index, diagnostics);
      }
    }
    if ("max" in context && (typeof context.max !== "string" || !BUDGET_RE.test(context.max))) {
      diagnostics.push(
        error("INVALID_BUDGET_FORMAT", pointer("model_context", contextIndex, "max"), "max must match /^\\d+k?$/."),
      );
    }
  }
  return diagnostics;
}
