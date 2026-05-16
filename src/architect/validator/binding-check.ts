import type { AgentSpecDraft } from "../spec/schema.js";
import type { SpecDiagnostic } from "./diagnostics.js";
import { error } from "./diagnostics.js";
import { isRecord, pointer } from "./helpers.js";

export function checkBindings(spec: AgentSpecDraft): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  const topLevel = new Map<string, string>();
  addBinding(topLevel, readName(spec.agent, "name"), "/agent/name", diagnostics);
  addBinding(topLevel, readName(spec.model, "import_name"), "/model/import_name", diagnostics);
  for (const [index, tool] of (Array.isArray(spec.tools) ? spec.tools : []).entries()) {
    addBinding(topLevel, readName(tool, "import_name"), pointer("tools", index, "import_name"), diagnostics);
  }

  const localNames = new Map<string, string>([["input", "/inputs"]]);
  for (const [index, local] of (Array.isArray(spec.locals) ? spec.locals : []).entries()) {
    const name = readName(local, "name");
    if (!name) continue;
    const path = pointer("locals", index, "name");
    const topLevelPath = topLevel.get(name);
    if (topLevelPath) {
      diagnostics.push(
        error("DUPLICATE_BINDING", path, `Local '${name}' conflicts with a top-level binding at ${topLevelPath}.`),
      );
    }
    addBinding(localNames, name, path, diagnostics);
  }
  return diagnostics;
}

function addBinding(
  bindings: Map<string, string>,
  name: string | null,
  path: string,
  diagnostics: SpecDiagnostic[],
): void {
  if (!name) return;
  const existing = bindings.get(name);
  if (existing) {
    diagnostics.push(error("DUPLICATE_BINDING", path, `Binding '${name}' conflicts with ${existing}.`));
    return;
  }
  bindings.set(name, path);
}

function readName(value: unknown, key: string): string | null {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : null;
}
