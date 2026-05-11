import type { ImportResourceKind } from "../ast/types.js";

export type BindingKind = "param" | "local" | "function" | "tool" | "llm" | "file" | "agent" | "memory";

export const IMPORT_RESOURCE_KINDS = new Set<ImportResourceKind>(["tool", "llm", "file", "agent", "memory"]);
export const IMPORTED_BINDING_KINDS = new Set<BindingKind>(["tool", "llm", "file", "agent", "memory"]);
export const MUTABLE_BINDING_KINDS = new Set<BindingKind>(["local", "param"]);
export const NON_CONTEXT_BINDING_KINDS = new Set<BindingKind>(["tool", "llm", "agent", "function", "memory"]);
export const URI_BINDING_KINDS = new Set<BindingKind>(["tool", "llm", "memory"]);

export function isImportResourceKind(value: string): value is ImportResourceKind {
  return IMPORT_RESOURCE_KINDS.has(value as ImportResourceKind);
}

export function importResourceKindToBindingKind(resourceKind: ImportResourceKind): BindingKind {
  return resourceKind;
}
