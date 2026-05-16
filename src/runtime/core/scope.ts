import type { Budget, Expr, SourceRange } from "../../ast/types.js";
import { type BindingKind, MUTABLE_BINDING_KINDS } from "../../language/bindings.js";
import { RuntimeError } from "./errors.js";
import type { RuntimeValue } from "../values/values.js";
import type { RuntimeUseOneOfCandidate } from "../context/use-one-of.js";

interface Binding {
  value: RuntimeValue;
  kind: BindingKind;
}

interface RuntimeContextUse {
  kind: "use";
  expr: Expr;
  source: string;
  budget?: Budget;
  label?: string;
  scope: RuntimeScope;
}

interface RuntimeContextUseOneOf {
  kind: "use_one_of";
  siteId: string;
  label: string;
  candidates: RuntimeUseOneOfCandidate[];
  scope: RuntimeScope;
}

export type RuntimeContextDeclaration = RuntimeContextUse | RuntimeContextUseOneOf;

export class RuntimeScope {
  private readonly bindings = new Map<string, Binding>();
  private readonly config = new Map<string, RuntimeValue>();
  private readonly uses: RuntimeContextDeclaration[] = [];

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

  set(name: string, value: RuntimeValue, range?: SourceRange): void {
    const binding = this.resolveBinding(name);
    if (binding && MUTABLE_BINDING_KINDS.has(binding.kind)) {
      binding.value = value;
      return;
    }
    if (binding) {
      throw new RuntimeError(`Cannot assign to immutable ${binding.kind} binding '${name}'`, range);
    }
    this.define(name, value);
  }

  addUse(expr: Expr, source: string, budget?: Budget, label?: string): void {
    this.uses.push({ kind: "use", expr, source, budget, label, scope: this });
  }

  addUseOneOf(siteId: string, label: string, candidates: RuntimeUseOneOfCandidate[]): void {
    this.uses.push({
      kind: "use_one_of",
      siteId,
      label,
      candidates,
      scope: this,
    });
  }

  setConfig(name: string, value: RuntimeValue): void {
    this.config.set(name, value);
  }

  getConfig(name: string): RuntimeValue | undefined {
    return this.config.get(name) ?? this.parent?.getConfig(name);
  }

  visibleUses(): RuntimeContextDeclaration[] {
    return [...(this.parent?.visibleUses() ?? []), ...this.uses];
  }

  private resolveBinding(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.resolveBinding(name);
  }
}
