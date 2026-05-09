# `generate`

This document defines the semantics of `generate` in AgentScript: generation sites, prompt layers, agent identity, selected context, output contracts, budgets, attempts, and trace output.

For context selection and labels, see [`use ... as ...`](./use-as.md). For the broader design map, see [Context Engineering](./context-engineering.md).

## Purpose

`generate` is the only LLM call site in AgentScript.

```agentscript
generate({ input: "Answer using the selected context." }) -> {
    ok boolean
    answer string
}
```

Ordinary code can compute values, call tools, call agents, and organize state. Only `generate` asks the current model to produce new output.

## Syntax

```agentscript
generate({
    input: "Answer using the selected context."
    limit: 800
    attempts: 3
    debug: true
}) -> {
    ok boolean
    answer string
    reason string
}
```

The output shape after `->` is optional:

```agentscript
generate({ input: "Draft a response." })
```

When no shape is declared, the runtime should not inject a schema or require structured JSON output.

## Prompt construction

A `generate` prompt has four conceptual layers.

### Agent identity

Agent identity comes from the current agent configuration:

```agentscript
role "Senior Researcher"
description "Answer questions with search and structured reasoning."
```

It is rendered into the provider system prompt as identity:

```text
You are Senior Researcher.
Answer questions with search and structured reasoning.
```

Agent `role` is an AgentScript identity concept. It is not the same as a provider message role such as `system`, `user`, or `assistant`.

### Selected context

Selected context comes from visible `use` declarations:

```agentscript
use input.question as user question
use scratch.summary < 2k as observations
```

A rendered prompt section may look like:

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

Context labels organize prompt sections. They do not create provider messages.

### Instruction

The instruction comes from the `input` field of `generate(...)`:

```agentscript
generate({ input: "Answer using only the selected context." }) -> {
    answer string
}
```

The instruction is the local task for this one LLM call. It is distinct from long-lived context.

### Output contract

The output contract comes from the optional shape after `->`:

```agentscript
generate({ input: "Answer" }) -> {
    ok boolean
    answer string
    citations list[string]
}
```

The runtime asks the provider for structured output when possible and validates the returned value against the shape.

## Budgets

`generate({ limit: n })` is a generation budget. It limits output size or maps to a provider token limit.

```agentscript
generate({
    input: "Summarize"
    limit: 500
}) -> {
    text string
}
```

This is different from a context item budget:

```agentscript
use docs.summary < 4k as evidence
```

The first controls generated output. The second controls how much selected context is rendered into the prompt.

## Attempts and repair

`attempts` controls how many times the runtime may try to obtain a valid result for the requested output shape.

```agentscript
generate({
    input: "Extract fields"
    attempts: 3
}) -> {
    title string
    tags list[string]
}
```

If a provider response is malformed or fails shape validation, the runtime may retry with repair feedback. Infrastructure errors should not be treated as repairable model output.

## Debug output

`debug: true` allows the runtime to print or expose the final prompt for inspection.

```agentscript
generate({
    input: "Answer"
    debug: true
}) -> {
    answer string
}
```

Debug output is for developers. It is not itself prompt context.

## Trace requirements

A `generate` trace should explain the actual prompt inputs and result:

```json
{
  "kind": "generate",
  "data": {
    "instruction": "Answer from observations",
    "context": {
      "context": [
        {
          "index": 0,
          "source": "scratch.summary",
          "label": "observations",
          "value": [{ "fact": "A" }],
          "text": "[...]",
          "budget": { "amount": 2, "unit": "k" },
          "clipped": false
        }
      ]
    },
    "attempts": 1,
    "result": { "answer": "..." }
  }
}
```

Trace answers:

- Which agent identity generated this output?
- What instruction was used?
- What selected context was visible?
- Which context items were clipped?
- What shape was requested?
- How many attempts were needed?
- What value was returned?

## Final expression return

A `generate` expression can be the final top-level expression in a function body. In that case, the function returns the generated value implicitly.

```agentscript
func answer(question) {
    use question as user question

    generate({ input: "Answer" }) -> {
        answer string
    }
}
```

This is equivalent to explicitly returning the generate result when no earlier explicit `return` is executed.

## Design checklist

Before changing `generate`, verify:

- Does it remain the only LLM call site?
- Does it use only visible `use` context sources?
- Does it keep agent identity, selected context, instruction, and output contract distinct?
- Does `role` remain agent identity rather than provider role control?
- Does `limit` remain a generation budget, not a context item budget?
- Does trace explain the actual prompt and result?
