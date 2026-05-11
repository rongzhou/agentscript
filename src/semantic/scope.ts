import type { ConfigKey, FuncDecl, SourceRange } from "../ast/types.js";
import { IMPORTED_BINDING_KINDS, type BindingKind } from "../language/bindings.js";

export interface Binding {
  kind: BindingKind;
  range: SourceRange;
  agentName?: string;
  functionName?: string;
  arity?: number;
  uri?: string;
}

export type DefineResult = { ok: true } | { ok: false; existing: Binding };

export class SemanticScope {
  private readonly bindings = new Map<string, Binding>();
  private readonly configs = new Set<ConfigKey>();

  constructor(private readonly parent?: SemanticScope) {}

  define(name: string, binding: Binding): DefineResult {
    const existing = this.bindings.get(name);
    if (existing) {
      return { ok: false, existing };
    }
    this.bindings.set(name, binding);
    return { ok: true };
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
