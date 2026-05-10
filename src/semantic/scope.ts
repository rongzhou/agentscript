import type { ConfigKey, FuncDecl, SourceRange } from "../ast/types.js";

export type BindingKind = "param" | "local" | "function" | "tool" | "llm" | "file" | "agent" | "memory";

export interface Binding {
  kind: BindingKind;
  range: SourceRange;
  agentName?: string;
  functionName?: string;
  arity?: number;
  uri?: string;
}

export class SemanticScope {
  private readonly bindings = new Map<string, Binding>();
  private readonly configs = new Set<ConfigKey>();

  constructor(private readonly parent?: SemanticScope) {}

  define(name: string, binding: Binding): boolean {
    if (this.bindings.has(name)) {
      return false;
    }
    this.bindings.set(name, binding);
    return true;
  }

  isLocalToThisScope(name: string): boolean {
    return this.bindings.has(name);
  }

  resolve(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.resolve(name);
  }

  defineConfig(name: ConfigKey): void {
    this.configs.add(name);
  }

  hasConfig(name: ConfigKey): boolean {
    return this.configs.has(name) || this.parent?.hasConfig(name) === true;
  }

  child(): SemanticScope {
    return new SemanticScope(this);
  }
}

export const IMPORTED_BINDING_KINDS = new Set<BindingKind>(["tool", "llm", "file", "agent", "memory"]);
export const NON_CONTEXT_BINDING_KINDS = new Set<BindingKind>(["tool", "llm", "agent", "function", "memory"]);

export function functionBinding(agentName: string, fn: FuncDecl): Binding {
  return {
    kind: "function",
    range: fn.range,
    agentName,
    functionName: fn.name,
    arity: fn.params.length,
  };
}

export function isImportedBinding(kind: BindingKind): boolean {
  return IMPORTED_BINDING_KINDS.has(kind);
}

export function importResourceKindToBindingKind(resourceKind: string): BindingKind {
  if (IMPORTED_BINDING_KINDS.has(resourceKind as BindingKind)) {
    return resourceKind as BindingKind;
  }
  return "file";
}
