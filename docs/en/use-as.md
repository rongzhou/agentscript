# `use ... as ...`

This document defines how `use` selects prompt context in AgentScript, including context labels, budgets, scope visibility, deferred evaluation, and trace requirements.

For the larger mental model, see [Context Engineering](./context-engineering.md). For prompt construction and output contracts, see [`generate`](./generate.md).

## Purpose

`use` is not a variable read, assignment, or namespace import. It declares a prompt context source.

```agentscript
use input.question as user question
use scratch.summary < 2k as observations
```

The meaning is:

```text
make this source visible to later generate calls in the current scope and child scopes
```

Local variables not selected with `use` do not enter the prompt.

## Syntax

```agentscript
use expr
use expr < budget
use expr as label
use expr < budget as label
```

The fixed order is:

```text
what to select -> how much to include -> what role it plays as context
```

Examples:

```agentscript
use input.question as user question
use docs.summary < 4k as retrieved evidence
use scratch.summary < 2k as observations
```

## Context labels

The label after `as` is literal label text. It is not an expression, is not evaluated, and does not read variables from scope.

```agentscript
use docs as evidence
use docs.summary < 4k as retrieved evidence
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
    use scratch.summary < 2k as observations

    scratch.add({ fact: "A" })
    scratch.add({ fact: "B" })

    generate({ input: "Answer from observations" }) -> {
        text string
    }
}
```

The `generate` call sees both facts.

This keeps `use` as a context contract instead of a value copy.

## Scope visibility

A `use` declaration is visible to later `generate` calls in the same scope and child scopes.

```agentscript
use input.question as user question

if input.needs_detail {
    use input.detail as detail
    generate({ input: "Answer with detail" }) -> {
        text string
    }
}
```

The inner `generate` can see both `user question` and `detail`. The `detail` context does not leak outside the block.

Function and agent calls form independent context boundaries. A callee does not automatically inherit the caller's selected context.

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
use results < 4k as search results
```

## Budget semantics

`use expr < budget` is a context item budget. It limits how much of that source may be rendered into the prompt.

```agentscript
use docs.summary < 4k as evidence
```

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
