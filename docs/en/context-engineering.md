# AgentScript Context Engineering

This document explains the core design semantics of `use`, scopes, and `generate` in AgentScript. These concepts are not specific to any version — they are the fundamental semantics that distinguish AgentScript from general-purpose programming languages.

AgentScript has variables, functions, loops, and agent calls, but its primary purpose is not to be a general-purpose language. It is an auditable, composable, explicit prompt context engineering DSL.

## Core positioning

AgentScript's control flow serves prompt context construction.

Ordinary statements organize data, call tools, call agents, and update intermediate state. LLM calls happen only through `generate(...) -> { ... }`, and the context visible to `generate` must be declared explicitly with `use`.

The core objects are:

- **Data**: ordinary variables, JSON values, lists, file imports, tool observations, agent return values.
- **Context Source**: a prompt context origin declared by `use expr < budget`.
- **Generation Site**: an LLM call declared by `generate({ input, limit, attempts, debug }) -> shape`.
- **Boundary**: context visibility boundaries formed by agent, function, and block scopes.

## Semantics of `use`

`use` is not a variable read or a namespace import. Its meaning is:

> Declare a prompt context source in the current scope, so that `generate` calls visible in that scope may include the source's current value in the prompt context.

Example:

```agentscript
func answer(question, scratch) {
    use question
    use scratch.summary < 2k

    return generate({
        input: "Answer the question using collected facts"
        limit: 800
    }) -> {
        ok boolean
        text string
        error string
    }
}
```

Here `question` and `scratch.summary` are explicit context sources for the `generate` call. Local variables not selected by `use` must not enter the prompt.

### Deferred evaluation

`use expr < budget` declares a context source, not a snapshot of the current value. The source is resolved at the `generate` execution point.

```agentscript
main func(input) {
    scratch = []
    use scratch.summary < 2k

    scratch.add({ fact: "A" })
    scratch.add({ fact: "B" })

    return generate({ input: "Answer from scratch" }) -> {
        text string
    }
}
```

The `generate` call sees both facts.

Rationale:

- `use` expresses a context contract, not an assignment.
- Agent patterns continuously update scratch, plans, and observations.
- A snapshot-based `use` would require re-declaration before every `generate`, risking stale context.

### What cannot be used

The following runtime capabilities must never enter prompt context:

- Imported tools
- Imported LLMs / models
- Imported agent bindings
- Function bindings
- Provider URIs, workspace paths, and other execution configuration

These should be rejected by the semantic analyzer:

```agentscript
use Search     -- invalid (tool binding)
use Qwen       -- invalid (LLM binding)
use Worker     -- invalid (agent binding)
use helper     -- invalid (function binding)
```

## Scope as context boundary

Scopes in AgentScript control both variable visibility and prompt context visibility.

### Function boundary

Each function call creates an independent context boundary.

```agentscript
func caller(input) {
    use input.goal
    return helper(input)
}

func helper(input) {
    use input.detail
    return generate({ input: "Work on detail" }) -> {
        ok boolean
    }
}
```

The `generate` inside `helper` must not inherit `caller`'s `use input.goal`. Data must be passed as arguments and explicitly `use`d.

### Agent boundary

Agent calls create a stronger context boundary.

```agentscript
result = Worker({
    goal: input.goal
    previous: results.summary
})
```

`Worker` must not see the caller's context. The caller passes data explicitly through arguments.

This guarantees:

- Each agent's prompt contract is independently auditable.
- Multi-agent composition does not cause implicit context leakage.
- Sub-agents see only explicitly passed data.

### Block boundary

Blocks (`if`, `repeat`, `loop`, `for`) create child scopes. `use` declarations inside a block affect only `generate` calls within that block.

```agentscript
if condition {
    temp = compute(input)
    use temp
    result = generate({ input: "Use temp" }) -> {
        ok boolean
    }
}
```

`temp` and `use temp` must not leak to the outer scope.

### Parent context visibility

A `generate` call in a nested scope can see context sources declared in parent scopes. The visible order must be stable from outer to inner for trace and prompt audit.

## Context construction model

A `generate` call's prompt consists of four layers.

### System

Describes agent identity and stable behavioral constraints:

- Agent name
- `role`
- `description`

Must not contain execution configuration (provider URIs, workspace paths, tool internals).

### Context

Comes from `use` declarations visible to the current `generate`.

Each context item records:

- source expression (e.g. `scratch.summary`)
- resolved value
- rendered text
- budget
- clipping status

Recommended prompt format:

```text
Context:
[0] question:
What is AgentScript?

[1] scratch.summary:
[
  { "fact": "..." }
]
```

Source labels help models understand context and help humans audit prompts.

### Instruction

Comes from the `input` field of `generate(...)` options.

```agentscript
generate({ input: "Answer the question using only collected facts" }) -> {
    ok boolean
    text string
}
```

The instruction is the per-call task. `limit`, `attempts`, and `debug` are local configuration, not prompt context. Error feedback from previous failed attempts is appended to the instruction.

### Output contract

Comes from `return { ... }` shape.

```agentscript
return {
    ok boolean
    text string
    error string
}
```

The LLM provider and runtime enforce shape compliance as strictly as possible.

## Budget semantics

`use expr < budget` is a **context item budget**. It limits how much of that source may be rendered into the prompt.

`generate({ limit: budget })` is a **generation budget**. It limits output size or the provider's token limit.

They have different meanings and must not be confused.

Character count is used as an approximation. Future implementations may switch to token-aware budgets without changing the abstraction.

## Clipping strategy

Context clipping must not simply truncate strings, as that would break JSON and list structure.

Strategy:

- Strings: may be truncated by character count.
- Lists: prefer keeping complete items, dropping from the tail.
- Objects: prefer keeping complete fields, dropping from the tail.
- Trace: record original size, clipped size, and strategy for each item.

## Trace requirements

Trace is the primary debugging interface for a context engineering DSL.

`use` trace:

```json
{
  "kind": "use",
  "data": {
    "source": "scratch.summary",
    "budget": { "amount": 2, "unit": "k" }
  }
}
```

`generate` trace:

```json
{
  "kind": "generate",
  "data": {
    "instruction": "Answer from scratch",
    "context": {
      "items": [
        {
          "source": "scratch.summary",
          "value": [{ "fact": "A" }],
          "text": "[...]",
          "budget": { "amount": 2, "unit": "k" },
          "clipped": false
        }
      ]
    }
  }
}
```

This answers:

- What did the LLM call actually see?
- Which context sources were declared but not included?
- What was clipped?
- Which expression was the source resolved from?
- Did caller and callee contexts leak?

## The `summary` view

`scratch.summary` is a common pattern:

```agentscript
scratch = []
scratch.add(observation)
use scratch.summary < 2k
```

It expresses "put the prompt-friendly view of scratch into context." If the implementation provides only a JSON-safe list view rather than a true LLM summary, this should be documented and visible in the trace.

## Implementation constraints

Future changes must respect:

- `generate` does not automatically capture local variables.
- `use` is a context declaration, not an assignment.
- `use` values are resolved when `generate` builds the prompt.
- Function and agent calls form context boundaries.
- Runtime capabilities must never enter prompt context.
- Prompts must distinguish system, context, instruction, and output contract layers.
- Trace must explain every `generate` call's actual context.

## Design checklist

Before modifying `use`, scope, context builder, trace, or the LLM provider, verify:

- Does this change let unused data enter the prompt?
- Does this change let caller context implicitly pollute callee?
- Does this change expose tool/model/agent/function bindings as prompt data?
- Does this change preserve audit information for context sources?
- Does this change reduce `use` to an ordinary variable snapshot?
- Does this change confuse context budget with generation budget?