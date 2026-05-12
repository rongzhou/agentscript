# `generate`

This document defines the semantics of `generate` in AgentScript: generation sites, prompt layers, agent identity, selected context, output contracts, generation configuration, retries, validation, debug output, and trace output.

For context selection and labels, see [`use ... as ...`](./use-as.md). For the broader design map, see [Context Engineering](./context-engineering.md). For the label-only default value rule in output contracts, see [Label-only Contract Fields](./generate-default-string-fields.md).

## Purpose

`generate` is the only LLM call site in AgentScript.

```agentscript
generate({ input: "Answer using the selected context." }) -> {
    ok: boolean
    answer
}
```

Ordinary code can compute values, call tools, call agents, and organize state. Only `generate` asks the current model to produce new output.

## Recommended syntax

```agentscript
generate({
    input: "Classify the issue",
    max_output: 300,
    attempts: 2,
    temperature: 0.2,
    think: "medium",
    strict: true,
    debug: false
}) -> {
    category
    confidence: number
}
```

The output contract after `->` is optional:

```agentscript
generate({ input: "Draft a response." })
```

When no contract is declared, the runtime should not inject a schema or require structured JSON output. Free-form generate is allowed but not recommended for agent workflows; prefer an explicit output contract so retries, validation, trace, and downstream agent calls stay auditable.

## Configuration fields

The argument to `generate(...)` is a JSON-like options object. It is not a
contract block. The optional contract is the block after `->`.

| Field | Required | Type | Meaning |
|---|---:|---|---|
| `input` | yes | `string` | Per-generation task instruction. |
| `max_output` | no | `number` / budget literal | Requested output generation budget. |
| `attempts` | no | `number` | Retry count for JSON parse failures or contract validation failures. |
| `temperature` | no | `number` | Sampling temperature passed to providers that support it. |
| `think` | no | `boolean` / `string` | Request model reasoning / thinking mode. |
| `strict` | no | `boolean` | Controls whether output contract validation is strict. |
| `debug` | no | `boolean` | Enables prompt / trace debug output for this generation. |

Recommended defaults:

```text
max_output: provider/runtime default
attempts: 1
temperature: provider/model default
think: false
strict: false
debug: false
```

The fields fall into three groups:

```text
Generation instruction:
  input

Generation provider hints:
  max_output
  temperature
  think

AgentScript runtime behavior:
  attempts
  strict
  debug
```

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
use input.question as "user question"
use scratch.summary max 2k as observations
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
    answer
}
```

The instruction is the local task for this one LLM call. It is distinct from long-lived context.

### Output contract

The output contract comes from the optional contract after `->`:

```agentscript
generate({ input: "Answer" }) -> {
    ok: boolean
    answer
    citations: list[string]
}
```

The runtime asks the provider for structured output when possible and validates the returned value against the contract.

## `max_output`

`max_output` is the requested provider-side generation budget.

```agentscript
generate({
    input: "Answer briefly",
    max_output: 300
}) -> {
    answer
}
```

Semantics:

```text
max_output = provider-side generation budget requested by AgentScript
```

It is separate from `use` input context budgets:

```agentscript
use docs.summary max 4k

generate({
    input: "Answer from the selected docs",
    max_output: 800
}) -> {
    answer
}
```

Difference:

```text
use ... max 4k       = input context budget
max_output: 800    = output generation budget
```

## `attempts`

`attempts` controls how many times the runtime may try to obtain a valid structured result. `attempts` is the maximum total number of attempts, including the first one.

```agentscript
generate({
    input: "Extract metadata",
    max_output: 500,
    attempts: 3
}) -> {
    title
    tags: list[string]
}
```

Retryable failures:

```text
JSON parse failed
contract validation failed
required field missing
type mismatch
strict mode violation
```

Non-retryable failures:

```text
provider auth error
network error
model not found
quota exceeded
timeout, unless runtime policy decides it is retryable
```

Default:

```text
attempts: 1
```

## `temperature`

`temperature` is the sampling temperature.

```agentscript
generate({
    input: "Brainstorm alternatives",
    max_output: 1000,
    temperature: 0.7
}) -> {
    ideas: list[string]
}
```

Semantics:

```text
If supported by the selected provider/model, pass through as sampling temperature.
If unsupported, adapter may ignore, warn, or fail according to capability policy.
```

## `think`

`think` is a model reasoning / thinking mode request.

Recommended values:

```agentscript
think: false,
think: true,
think: "auto",
think: "low",
think: "medium",
think: "high"
```

Semantics:

```text
false     do not request thinking/reasoning mode
true      request provider default thinking/reasoning mode
"auto"    let provider/model decide
"low"     request low-intensity reasoning
"medium"  request medium-intensity reasoning
"high"    request high-intensity reasoning
```

Example:

```agentscript
generate({
    input: "Analyze the tradeoffs",
    max_output: 1200,
    think: "high"
}) -> {
    decision
    tradeoffs: list[string]
    risks: list[string]
}
```

`think` is a provider/model capability hint. Not every model guarantees support. If unsupported, the adapter may ignore, warn, or fail according to capability policy.

Current provider mappings:

```text
OpenAI:    true -> medium, low/medium/high -> reasoning_effort
Anthropic: true/auto/low -> 1024 thinking tokens, medium -> 4096, high -> 10000
Ollama:    passes the value through as the chat API think field
```

For Anthropic, `max_output` remains the requested final answer budget. The adapter adds the thinking budget to the Anthropic `max_tokens` request because Anthropic counts thinking tokens inside `max_tokens`. Anthropic extended thinking is rejected when `temperature` is also set.

## Capability policy for provider hints

`temperature` and `think` are provider/model capability hints. Unsupported provider hints default to warn in debug mode and ignore otherwise.

Adapters may ignore, warn, or fail for unsupported hints according to runtime capability policy, but documentation should treat the default as:

```text
unsupported provider hints default to warn in debug mode and ignore otherwise
```

## `strict`

`strict` controls output contract validation.

```agentscript
generate({
    input: "Classify the issue",
    max_output: 300,
    strict: true
}) -> {
    category
    confidence: number
}
```

Default:

```text
strict: false
```

### `strict: false`

Allows limited coercion:

```text
"true"  -> true
"false" -> false
"42"    -> 42
"3.14"  -> 3.14
```

Still required:

```text
output is parseable
required fields exist
unsafe conversions fail
```

### `strict: true`

Strict validation:

```text
coercion is forbidden
required fields must exist
field types must match exactly
extra fields are rejected
contract mismatch triggers retry if attempts > 1
```

In one sentence:

```text
strict is AgentScript runtime control over the output contract.
```

## `debug`

`debug` controls debug output for this `generate` call.

```agentscript
generate({
    input: "Answer the question",
    max_output: 800,
    debug: true
}) -> {
    answer
}
```

Recommended debug output:

```text
resolved agent identity
generate input
selected context entries
context labels
budgets
rendered prompt/messages
output contract
raw model output
validation result
```

`debug` only affects debug output. It does not change prompt semantics.

## Trace requirements

A `generate` trace should explain the actual prompt inputs, configuration, validation, and result:

```json
{
  "kind": "generate",
  "data": {
    "instruction": "Answer from observations",
    "config": {
      "max_output": 800,
      "attempts": 1,
      "temperature": 0.2,
      "think": "medium",
      "strict": false,
      "debug": false
    },
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
    "validation": { "ok": true, "strict": false },
    "result": { "answer": "..." }
  }
}
```

Trace answers:

- Which agent identity generated this output?
- What instruction was used?
- What selected context was visible?
- Which context items were clipped?
- What provider hints and runtime behavior were requested?
- What contract was requested?
- How many attempts were needed?
- What validation mode was used?
- What value was returned?

## Final expression return

A `generate` expression can be the final top-level expression in a function body. In that case, the function returns the generated value implicitly.

```agentscript
func answer(question) {
    use question as "user question"

    generate({ input: "Answer" }) -> {
        answer
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
- Does `max_output` remain an output generation budget, not a context item budget?
- Does `strict` remain runtime validation behavior rather than provider configuration?
- Does `think` remain a provider/model capability hint rather than guaranteed reasoning access?
- Does trace explain the actual prompt, configuration, validation, and result?
