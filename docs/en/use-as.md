# `use ... as ...`

This document defines how `use` selects prompt context in AgentScript, including context labels, budgets, scope visibility, deferred evaluation, and trace requirements.

For the larger mental model, see [Context Engineering](./context-engineering.md). For prompt construction and output contracts, see [`generate`](./generate.md).

## Purpose

`use` is not a variable read, assignment, or namespace import. It declares a prompt context source.

```agentscript
use input.question as "user question"
use scratch.summary max 2k as observations
```

The meaning is:

```text
make this source visible to later generate calls in the current scope and child scopes
```

Local variables not selected with `use` do not enter the prompt.

## Syntax

```agentscript
use expr
use expr max budget
use expr as label
use expr max budget as label
```

`label` must be either a single identifier or a string literal. Use a string literal for labels that contain spaces.

The fixed order is:

```text
what to select -> how much to include -> what role it plays as context
```

Examples:

```agentscript
use input.question as "user question"
use docs.summary max 4k as "retrieved evidence"
use scratch.summary max 2k as observations
```

## Context labels

The label after `as` is literal label text. It is not an expression, is not evaluated, and does not read variables from scope.

```agentscript
use docs as evidence
use docs.summary max 4k as "retrieved evidence"
use input.question as user
```

`as evidence` labels the context section as `evidence` even if a variable named `evidence` exists.

Labels affect:

- prompt section labels
- trace display
- context organization
- debug and audit readability

Labels do not affect:

- agent identity
- provider message roles
- tool permissions
- system/user/assistant authority

## Provider roles are not context labels

Provider roles such as `system`, `user`, `assistant`, and `tool` are LLM API transport details. AgentScript context labels are prompt-internal organization labels.

The following labels are reserved to avoid confusion with provider roles:

```text
system
assistant
tool
developer
```

`user` is allowed as a context label because it often means "this context item is user input". It still does not create a separate provider `user` message.

## Deferred evaluation

`use expr` declares a source, not a snapshot. The expression is evaluated when a visible `generate` builds its prompt.

```agentscript
main func(input) {
    scratch = []
    use scratch.summary max 2k as observations

    scratch.add({ fact: "A" })
    scratch.add({ fact: "B" })

    generate({ input: "Answer from observations" }) -> {
        text
    }
}
```

The `generate` call sees both facts.

This keeps `use` as a context contract instead of a value copy.

## Scope visibility

AgentScript has two nested context scopes — **agent** and **function** — plus block sub-scopes within each (`if` / `for` / `loop` / `repeat` / `parallel for`). `use` can appear in all three positions.

Three-level overview:

| Level | Declared at | Visible to | Purpose |
|---|---|---|---|
| Agent-level | Top of the agent body, alongside `model` / `role` | All functions of this agent and their sub-scopes | Part of agent identity; shared default context for every call into this agent |
| Function-level | Inside a function body | That function and its block sub-scopes | Path-specific context for this function, **not forwarded to functions it calls** |
| Block-level | Inside `if` / `for` / `loop` / `repeat` / `parallel for` | That block and its sub-scopes | Context scoped to one branch or iteration |

Core rule: **declarations are visible downward; call boundaries do not carry context**. A child scope sees its parents' `use` declarations; a function or agent call crosses the boundary, so the caller's function-local `use` never reaches the callee.

### Agent-level `use`

Declared inside the agent body, alongside `model` / `role` / `description`, as part of the agent's declaration section.

```agentscript
import file Playbook from "./playbook.md"

main agent Researcher {
    model Fast
    role "Researcher"
    description "Answer with playbook discipline."

    use Playbook as playbook

    main func(input) {
        generate({ input: input.question }) -> { text }
    }
}
```

Meaning: "Whenever this agent is entered, `Playbook` is injected as `playbook` context by default."

Agent-level `use` is **declarative**:

- It describes the agent's default context and is part of the agent's identity, at the same level as `role` / `description`.
- The expression may only reference names resolvable at agent top level — in practice, files brought in by `import file`. It must not depend on function parameters, function-local variables, or call expressions.
- Like function-level `use`, the value is still evaluated lazily when `generate` builds its prompt.

To pin the result of a `memory.query` or tool call as context, use the "call then use" pattern inside a function (see below).

### Function-level `use`

Declared in a function body. Visible to later `generate` calls in that function and its block sub-scopes, **not propagated to other functions it calls**.

```agentscript
main func(input) {
    lessons = Lessons.query({ kind: "how-to" })
    use lessons as "past lessons"
    use input.question as "user question"

    generate({ input: input.question }) -> { text }
}
```

This is the canonical way to turn call results into context: the "call then use" pattern — store the call result in a local variable, then declare it as context with `use`.

### Block-level `use`

Declared inside `if` / `for` / `loop` / `repeat` / `parallel for`. Visible only within that block and its sub-scopes. It is discarded when the block ends and does not affect the outer scope.

```agentscript
use input.question as "user question"

if input.needs_detail {
    use input.detail as detail
    generate({ input: "Answer with detail" }) -> { text }
}
```

The inner `generate` sees `user question` and `detail`. Once the `if` block ends, `detail` is no longer visible.

### Function calls within the same agent

A function call **does not forward** the caller's function-local `use`. The callee sees its own agent's agent-level `use`, plus any `use` declared in its own body.

```agentscript
import file Doc0 from "./doc0.md"
import file Doc1 from "./doc1.md"
import file Doc2 from "./doc2.md"

main agent A {
    use Doc0 as base

    main func(input) {
        return b(input)
    }

    func b(input) {
        use Doc2 as detail
        a(input)
    }

    func a(input) {
        use Doc1 as reference
        generate({ input: input.question }) -> { text }
    }
}
```

The `generate` call inside `a` sees:

- `base` (agent-level `use Doc0`)
- `reference` (a's function-level `use Doc1`)
- not `detail` (b's function-local `use Doc2` does not travel into the callee)

### Cross-agent calls

An agent invoked via `import agent` has its own independent agent scope. Neither the caller's agent-level nor function-level context crosses into the callee.

```agentscript
import agent Worker from "./worker.as"

main agent A {
    use Doc0 as base

    main func(input) {
        return Worker(input)
    }
}
```

A `generate` call inside `Worker` sees only `Worker`'s own agent-level `use` plus the `use` declared in the invoked function body. It does not see `Doc0`.

### Design intent

- **Agent is the context boundary**: an agent is both a capability boundary (which tools / llms / memories it can call) and a context boundary (what its default context is).
- **Function is an execution unit, not a context unit**: function calls organize execution paths without implicitly carrying context. To let a callee see a piece of context, pass the data explicitly as an argument and have the callee declare its own `use`.
- **Block is a local context extension**: block scope keeps transient context from leaking, so "this context applies only inside one branch" is expressible.

### Context resolution rule

For any `generate` expression, its context set is determined statically from the source:

1. Start with the agent-level `use` declarations of the enclosing agent.
2. Walk from the enclosing function outward through the scope chain to that `generate`: at each scope, include every `use` declaration that textually precedes the `generate`.
3. Ignore everything else: no `use` from caller functions, no `use` from other agents, no `use` appearing after the `generate`.

Consequences:

- Reading a `generate` in isolation, you can enumerate its context by reading its enclosing function body and its enclosing agent body. No need to follow call chains.
- Refactoring a function into smaller helpers does not silently change the context seen by any `generate` — helpers start with a clean context slate. Context the helper needs must be either inherited from the shared agent-level `use` or explicitly passed in and re-declared via `use`.
- Tools and documentation can list an agent's default context surface (its agent-level `use` set) without running the program.

## What cannot be used

Runtime capabilities must not enter prompt context:

- imported tools
- imported LLM/model bindings
- imported agent bindings
- memory handles
- function bindings
- provider URIs and workspace/runtime configuration

Invalid examples:

```agentscript
use Search
use Qwen
use Worker
use helper
```

Use the data returned by these capabilities instead:

```agentscript
results = Search.search(input.question)
use results max 4k as "search results"
```

## Budget semantics

`use expr max budget` is a context item budget. It limits how much of that source may be rendered into the prompt.

```agentscript
use docs.summary max 4k as evidence
```

Clipping is deterministic and structure-preserving, not semantic summarization.
Strings keep their leading characters. Lists keep a leading prefix of items in
list order. Objects keep a leading prefix of enumerable fields in JavaScript
insertion order. If semantic priority matters, construct a smaller value before
`use` instead of relying on the budget to rank content.

This is different from `generate({ max_output: ... })`, which is an output generation budget. See [`generate`](./generate.md).

## Prompt rendering

A labeled context item is rendered as a context section:

```text
Context:
[user question]
source: input.question
What is AgentScript?

[observations]
source: scratch.summary
[
  { "fact": "..." }
]
```

If no label is provided, the renderer may use the numeric context index and include the source expression separately.

## Trace requirements

A `use` trace event records the declaration:

```json
{
  "kind": "use",
  "data": {
    "source": "scratch.summary",
    "label": "observations",
    "budget": { "amount": 2, "unit": "k" }
  }
}
```

A generated built context item records the resolved value and rendering metadata:

```json
{
  "index": 0,
  "source": "scratch.summary",
  "label": "observations",
  "value": [{ "fact": "A" }],
  "text": "[...]",
  "budget": { "amount": 2, "unit": "k" },
  "clipped": false
}
```

Trace must make the selected source, label, budget, clipping status, and resolved value auditable.

## Design checklist

Before changing `use`, verify:

- Does unused data stay out of prompts?
- Is the source evaluated at `generate` time?
- Does the label remain literal text rather than an expression?
- Are provider roles still separate from context labels?
- Are budgets attached to context items, not the whole generation?
- Do function and agent boundaries prevent context leakage?
- Does agent-level `use` remain declarative (no function-local state, no call expressions)?
