import type { Budget, Expr, SourceRange } from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import type { RuntimeValue } from "./types.js";

type BindingKind = "local" | "param" | "function" | "tool" | "llm" | "file" | "agent" | "memory";

const MUTABLE_BINDING_KINDS = new Set<BindingKind>(["local", "param"]);

interface Binding {
  value: RuntimeValue;
  kind: BindingKind;
}

export interface RuntimeContextUse {
  expr: Expr;
  source: string;
  budget?: Budget;
  scope: RuntimeScope;
}

export class RuntimeScope {
  private readonly bindings = new Map<string, Binding>();
  private readonly config = new Map<string, RuntimeValue>();
  private readonly uses: RuntimeContextUse[] = [];

  constructor(readonly parent?: RuntimeScope) {}

  child(): RuntimeScope {
    return new RuntimeScope(this);
  }

  define(name: string, value: RuntimeValue, kind: BindingKind = "local"): void {
    this.bindings.set(name, { value, kind });
  }

  get(name: string, range?: SourceRange): RuntimeValue {
    const binding = this.resolveBinding(name);
    if (!binding) {
      throw new RuntimeError(`Unknown variable '${name}'`, range);
    }
    return binding.value;
  }

  set(name: string, value: RuntimeValue): void {
    const binding = this.resolveBinding(name);
    if (binding && MUTABLE_BINDING_KINDS.has(binding.kind)) {
      binding.value = value;
      return;
    }
    this.define(name, value);
  }

  addUse(expr: Expr, source: string, budget?: Budget): void {
    this.uses.push({ expr, source, budget, scope: this });
  }

  setConfig(name: string, value: RuntimeValue): void {
    this.config.set(name, value);
  }

  getConfig(name: string): RuntimeValue | undefined {
    return this.config.get(name) ?? this.parent?.getConfig(name);
  }

  visibleUses(): RuntimeContextUse[] {
    return [...(this.parent?.visibleUses() ?? []), ...this.uses];
  }

  private resolveBinding(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.resolveBinding(name);
  }
}
