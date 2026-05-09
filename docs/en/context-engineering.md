# AgentScript Context Engineering

This document is the top-level design map for AgentScript context engineering. It explains why AgentScript exists, what boundaries it enforces, and how the detailed `use ... as ...` and `generate` documents fit together.

AgentScript has variables, functions, loops, tools, memory, and agent calls, but its purpose is not to be a general-purpose programming language. Its purpose is to make prompt context explicit, scoped, typed, traceable, and auditable.

## Document structure

The context engineering design is split into three documents:

- **Context Engineering**: this overview; explains the mental model and invariants.
- **[`use ... as ...`](./use-as.md)**: explains how data is selected as prompt context, how labels work, how budgets are applied, and how scope affects visibility.
- **[`generate`](./generate.md)**: explains generation sites, prompt construction, agent identity, output contracts, budgets, retries, and trace output.

The language reference remains the compact syntax reference. These design documents define the intended semantics.

## Core model

AgentScript control flow serves prompt context construction.

Ordinary statements organize data, call tools, call agents, query memory, and update intermediate state. LLM calls happen only through `generate(...) -> { ... }`. A `generate` call sees only context sources explicitly declared with `use` and visible through scope.

The core objects are:

- **Data**: ordinary values such as input, JSON, lists, file contents, tool observations, memory query results, and agent return values.
- **Context source**: data selected for prompt context by `use expr`, optionally with a budget and label.
- **Generation site**: one LLM call expressed by `generate({ input, max_output, attempts, temperature, think, strict, debug }) -> shape`.
- **Boundary**: a visibility boundary formed by an agent, function, or block scope.
- **Trace**: the audit record explaining which sources were selected, how prompt context was built, and what each generation returned.

## Key invariants

AgentScript should preserve these invariants:

- **No implicit capture**: local variables, tool outputs, memory records, and trace events do not enter prompts unless selected with `use`.
- **Scoped visibility**: context visibility follows scope. Child scopes can inherit parent context; function and agent calls create independent context boundaries.
- **Capability isolation**: imported tools, models, agents, memory handles, functions, provider URIs, and runtime configuration are capabilities, not prompt data.
- **Deferred context resolution**: `use expr` declares a source. The value is resolved when a visible `generate` builds its prompt.
- **Layered prompts**: prompts distinguish agent identity, selected context, instruction, and output contract.
- **Auditable traces**: trace output must explain what the LLM call actually saw, including source expressions, labels, budgets, clipping, and generated results.

## Boundary model

### Function boundary

Each function call has its own context boundary. A callee does not automatically inherit the caller's selected context. Data must be passed as an argument and selected again when the callee wants it in its own prompt.

```agentscript
func caller(input) {
    use input.goal as goal
    helper(input)
}

func helper(input) {
    use input.detail as detail
    generate({ input: "Work on detail" }) -> {
        ok boolean
    }
}
```

The `generate` inside `helper` sees `input.detail`, not `caller`'s `input.goal`.

### Agent boundary

Agent calls create a stronger boundary. A called agent does not see the caller's prompt context. It sees only its input value and the context selected by its own functions.

```agentscript
result = Worker({
    goal: input.goal
    previous: results.summary
})
```

This keeps multi-agent composition auditable: each agent has its own prompt contract.

### Block boundary

Blocks such as `if`, `repeat`, `loop`, and `for` create child scopes. Context declared inside the block affects `generate` calls inside that block and does not leak upward.

## Prompt layers

A `generate` call is built from four conceptual layers:

1. **Agent identity**: current agent `role`, `description`, and stable behavioral identity.
2. **Selected context**: visible `use` declarations, rendered with source, label, value, and budget information.
3. **Instruction**: the per-call task from `generate({ input: ... })`.
4. **Output contract**: the optional `-> { ... }` shape.

See [`generate`](./generate.md) for the detailed construction rules.

## Design checklist

Before changing `use`, scope, context builder, trace, or LLM provider behavior, verify:

- Does this let unused data enter a prompt?
- Does this let caller context pollute a callee?
- Does this expose tool/model/agent/function bindings as prompt data?
- Does this preserve source, label, budget, and clipping information for audit?
- Does this reduce `use` to a snapshot assignment instead of a deferred context source?
- Does this confuse context budget with generation budget?
- Does this confuse AgentScript context labels with provider message roles?

AgentScript's core value is not another control-flow syntax. Its value is making prompt context source, scope, budget, identity, and final prompt shape explicit and stable.
