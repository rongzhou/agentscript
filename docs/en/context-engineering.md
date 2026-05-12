# AgentScript Context Engineering

This document is the top-level design map for AgentScript context engineering. It explains why AgentScript exists, what boundaries it enforces, and how the detailed `use ... as ...`, `use one of`, and `generate` documents fit together.

AgentScript has variables, functions, loops, tools, memory, and agent calls, but its purpose is not to be a general-purpose programming language. Its purpose is to make prompt context explicit, scoped, typed, traceable, and auditable.

## Document structure

Detailed context-engineering semantics are split into three documents:

- **[`use ... as ...`](./use-as.md)**: explains how data is selected as prompt context, how labels work, how budgets are applied, and how scope affects visibility.
- **[`use one of ...`](./use-one-of.md)**: explains how one context slot can declare multiple candidate sources, how `selected` and `empty` work, and how optimizers can treat context choice as a structured search space.
- **[`generate`](./generate.md)**: explains generation sites, prompt construction, agent identity, output contracts, budgets, retries, and trace output.

This overview explains the mental model and invariants. The language reference remains the compact syntax reference.

## Core model

AgentScript control flow serves prompt context construction.

Ordinary statements organize data, call tools, call agents, query memory, and update intermediate state. LLM calls happen only through `generate(...) -> { ... }`. A `generate` call sees only context sources explicitly declared with `use` and visible through scope.

The core objects are:

- **Data**: ordinary values such as input, JSON, lists, file contents, tool observations, memory query results, and agent return values.
- **Context source**: data selected for prompt context by `use expr`, optionally with a budget and label.
- **Context choice point**: a single context slot declared with `use one of { ... }`, where exactly one candidate source is selected before a visible `generate` builds its prompt.
- **Generation site**: one LLM call expressed by `generate({ input, max_output, attempts, temperature, think, strict, debug }) -> contract`.
- **Boundary**: a visibility boundary formed by an agent, function, or block scope.
- **Trace**: the audit record explaining which sources were selected, how prompt context was built, and what each generation returned.

## Key invariants

AgentScript should preserve these invariants:

- **No implicit capture**: local variables, tool outputs, memory records, and trace events do not enter prompts unless selected with `use`.
- **Scoped visibility**: context visibility follows scope. Child scopes can inherit parent context; function and agent calls create independent context boundaries.
- **Capability isolation**: imported tools, models, agents, memory handles, functions, provider URIs, and runtime configuration are capabilities, not prompt data.
- **Deferred context resolution**: `use expr` declares a source. The value is resolved when a visible `generate` builds its prompt.
- **Deterministic context choice**: `use one of` resolves to one candidate by runtime trial hint, source `selected`, or source order before prompt construction. The model sees only the selected source, not the candidate list.
- **Deterministic clipping**: context budgets clip rendered values by prefix. They do not rank, summarize, or semantically compress content.
- **Layered prompts**: prompts distinguish agent identity, selected context, instruction, and output contract.
- **Auditable traces**: trace output must explain what the LLM call actually saw, including source expressions, labels, budgets, clipping, and generated results.

## Declaration and execution

AgentScript mixes two syntactic modes on purpose. This is the main departure from general-purpose languages and the main reason AgentScript exists as a DSL for LLM programming.

- **Declarative mode** describes what an agent or a scope *is*: which model it uses (`model`), who it is (`role`, `description`), and what context it default-carries (`use` at agent level). These are statements of identity. They are legal only in declaration positions (agent body top, or at scope level as `use`) and they are read by the prompt builder, not by a general-purpose interpreter.
- **Execution mode** describes what the agent *does*: call tools, query memory, branch on input, build intermediate data, and finally call `generate`. This is ordinary statement code inside function bodies.

The boundary is enforced by syntax: `model` / `role` / `description` appear only in agent bodies; expression statements appear only in function bodies; `use` appears in both but means the same thing — "this source enters the prompt of every `generate` visible to this scope". `use one of` keeps the same boundary, but makes the source position selectable: one label, multiple candidate sources, one deterministic selection.

Two rules keep the boundary sharp:

1. **Agent-level declarations do not run arbitrary code.** An agent-level `use` expression may only reference names resolvable at the agent top level (primarily `import file` bindings). It cannot read function parameters, local variables, or call expressions. This keeps an agent's default context auditable without running the program.
2. **Tool and memory calls go in execution mode, not in `use`.** Even when you want a fresh query result as context, write it as two statements:

   ```agentscript
   lessons = Lessons.query({ kind: "how-to" })
   use lessons as "past lessons"
   ```

   This `call then use` pattern costs one extra line but preserves the invariant that `use` is always a context declaration and never a side-effectful action. Call expressions stay in one place; context declarations stay in another; the two never overload a single statement.

Why this matters:

- **Static readability.** The set of context sources a `generate` can see is a function of source position only. Readers do not need to trace which calls produce which bindings in order to understand what a prompt will contain.
- **Tooling leverage.** An agent's default context surface (its agent-level `use` declarations) is a static property. Linters, audit tools, and documentation generators can extract it without executing the program.
- **Refactoring safety.** Rewriting `lessons = Lessons.query(...)` into a helper, a cache, or a conditional changes the value flowing into `lessons` without touching the `use lessons as "past lessons"` declaration. The prompt surface stays visually stable.
- **Audit clarity.** Every `use` trace event corresponds to exactly one source-level declaration. "Why did this text enter the prompt?" maps to a single line of code, not to an expression buried inside a call.

The extra line required by `call then use` is the cost of this clarity. AgentScript takes this cost deliberately.

## Boundary model

AgentScript defines three scope kinds — agent, function, block — which form two kinds of boundaries: **visibility boundaries** (`use` declarations propagate down into child scopes) and **call boundaries** (function or agent calls cut context propagation off).

### Agent boundary

An agent is the context unit of the language. It plays two roles at once:

- **Capability boundary**: which tools, llms, memories, or agents this agent may call.
- **Context boundary**: `use` declarations at the top of the agent body form the default context every function call entering this agent starts with. When an agent is invoked (as `main` entry or via `import agent`), the callee uses its own agent-level `use` and does not inherit the caller's context at all.

```agentscript
import file Playbook from "./playbook.md"
import agent Worker from "./worker.as"

main agent A {
    use Playbook as playbook

    main func(input) {
        return Worker(input)
    }
}
```

A `generate` inside `Worker` cannot see `Playbook`; it only sees the context `Worker` declares for itself. Each agent carries its own prompt contract.

### Function boundary

A function is an execution unit, not a context unit. When functions inside the same agent call one another:

- The callee sees its enclosing agent's agent-level `use` (shared identity).
- The callee **does not** see the caller's function-local `use` (runtime-selected context does not travel).
- To give a callee access to context, the caller must pass the data as an argument, and the callee must `use` it explicitly.

```agentscript
func caller(input) {
    use input.goal as goal
    helper(input)
}

func helper(input) {
    use input.detail as detail
    generate({ input: "Work on detail" }) -> {
        ok: boolean
    }
}
```

The `generate` inside `helper` sees `helper`'s own `input.detail` (plus the enclosing agent's agent-level `use`), not `caller`'s `input.goal`.

### Block boundary

`if`, `repeat`, `loop`, `for`, and `parallel for` create child scopes. A `use` declared inside a block affects `generate` calls in that block and is discarded when the block ends. Block scopes never cross function or agent boundaries, so a block-level `use` is effectively a localized extension of a function-level `use` along one execution path.

## Prompt layers

A `generate` call is built from four conceptual layers:

1. **Agent identity**: current agent `role`, `description`, and stable behavioral identity.
2. **Selected context**: visible `use` declarations, including resolved `use one of` choices, rendered with source, label, value, and budget information.
3. **Instruction**: the per-call task from `generate({ input: ... })`.
4. **Output contract**: the optional `-> { ... }` contract.

See [`generate`](./generate.md) for the detailed construction rules.

## Design checklist

Before changing `use`, scope, context builder, trace, or LLM provider behavior, verify:

- Does this let unused data enter a prompt?
- Does this let caller context pollute a callee?
- Does this expose tool/model/agent/function bindings as prompt data?
- Does this preserve source, label, budget, and clipping information for audit?
- Does this preserve the documented clipping order for strings, lists, and objects?
- Does this reduce `use` to a snapshot assignment instead of a deferred context source?
- Does this keep `use one of` as a deterministic choice over ordinary `use` candidates, rather than hidden runtime learning state?
- Does this confuse context budget with generation budget?
- Does this confuse AgentScript context labels with provider message roles?
- Does agent-level `use` remain declarative (no function-local state, no call expressions)?
- Does this allow call expressions inside `use`, breaking the `call then use` separation?

AgentScript's core value is not another control-flow syntax. Its value is making prompt context source, scope, budget, identity, and final prompt contract explicit and stable.
