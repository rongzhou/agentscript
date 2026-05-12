import type { ImportResourceKind } from "../ast/types.js";

export type BindingKind = "param" | "local" | "function" | "tool" | "llm" | "file" | "agent" | "memory";

interface BindingKindSpec {
  imported: boolean;
  mutable: boolean;
  prompt: boolean;
  hasUri: boolean;
}

const BINDING_KIND_SPECS: Record<BindingKind, BindingKindSpec> = {
  param: { imported: false, mutable: true, prompt: true, hasUri: false },
  local: { imported: false, mutable: true, prompt: true, hasUri: false },
  function: { imported: false, mutable: false, prompt: false, hasUri: false },
  tool: { imported: true, mutable: false, prompt: false, hasUri: true },
  llm: { imported: true, mutable: false, prompt: false, hasUri: false },
  file: { imported: true, mutable: false, prompt: true, hasUri: false },
  agent: { imported: true, mutable: false, prompt: false, hasUri: false },
  memory: { imported: true, mutable: false, prompt: false, hasUri: true },
};

const IMPORT_RESOURCE_KINDS = new Set<ImportResourceKind>(["tool", "llm", "file", "agent", "memory"]);
export const IMPORTED_BINDING_KINDS = bindingKindsWhere((spec) => spec.imported);
export const MUTABLE_BINDING_KINDS = bindingKindsWhere((spec) => spec.mutable);
export const NON_CONTEXT_BINDING_KINDS = bindingKindsWhere((spec) => !spec.prompt);
export const URI_BINDING_KINDS = bindingKindsWhere((spec) => spec.hasUri);

export function isImportResourceKind(value: string): value is ImportResourceKind {
  return IMPORT_RESOURCE_KINDS.has(value as ImportResourceKind);
}

function bindingKindsWhere(predicate: (spec: BindingKindSpec) => boolean): Set<BindingKind> {
  return new Set(
    (Object.entries(BINDING_KIND_SPECS) as [BindingKind, BindingKindSpec][])
      .filter(([, spec]) => predicate(spec))
      .map(([kind]) => kind),
  );
}
