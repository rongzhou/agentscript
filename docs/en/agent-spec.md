# AgentSpec

This document defines AgentSpec, a JSON format that describes an AgentScript
agent as a structured behavior blueprint. AgentSpec is designed to be compiled
deterministically into current legal AgentScript source.

For the language reference see [AgentScript Language](./language.md). For
selection-time optimization of `.as` programs see
[Optimizer Toolchain](./optimizer.md).

## Purpose

AgentSpec is not a new language. It is not a YAML config format. It is not a
prompt template. It is a JSON object that captures the design decisions an
AgentScript author would otherwise make in source:

```text
which model is used
which inputs the agent accepts
which tools the agent imports and what methods it calls
which intermediate values it computes
which of those values enter model context
which agent pattern shapes the control flow
what the generation instruction is
what output contract the model must satisfy
```

The design contract is:

```text
Any AgentSpec that passes the validator must compile to AgentScript source
that passes the current parser and semantic analyzer.
```

This is what makes AgentSpec useful as an LLM target: the LLM produces a
structured object instead of free-form `.as` text, the validator gives precise
diagnostics on references and shape, and the compiler is a deterministic
function from spec to source.

## Why JSON

AgentSpec uses JSON, not YAML:

- JSON object keys preserve insertion order under `JSON.stringify` and
  `JSON.parse`, which lets the compiler emit fields in author order.
- LLM structured output APIs target JSON natively.
- TypeScript handles JSON without an external parser.
- JSON avoids YAML indentation and parsing ambiguity.

When humans review a spec, tools may render it as YAML-like text. The storage
format and the validator input are still JSON.

## Patterns

An AgentSpec has exactly one **pattern**, which determines the control flow
the compiler emits inside `main func`. Phase 1 supports two patterns:

| Pattern | Shape | When to use |
|---------|-------|-------------|
| `"linear"` | locals → use → generate | Single-shot RAG agents that compute tool results once and answer. |
| `"react"` | locals → use → loop(reason → act → observe) → final generate | Iterative agents that need to decide what to fetch next based on what they have seen so far. |

The `pattern` field is the spec discriminator:

```json
{ "version": "0.1", "pattern": "react", ... }
```

Omitting `pattern` is equivalent to `"linear"`. This keeps existing linear
specs valid as `pattern` is introduced.

`pattern` is an **open extension point**. Future versions may add patterns
such as `"plan_execute"`, `"reflection"`, or a fully generic `"stages"` form
with a small expression language. Adding a new pattern is additive: a spec
with `pattern: "linear"` or `pattern: "react"` continues to validate and
compile identically. A validator that does not recognize a pattern returns
an `UNSUPPORTED_PATTERN` diagnostic; it does not silently accept it.

Each pattern has its own pattern block at the top level (`react: { ... }`,
future `plan_execute: { ... }`, etc.). The pattern block is required when
the spec uses that pattern, and forbidden when it uses any other.

## Top-level shape

```json
{
  "version": "0.1",
  "pattern": "react",
  "agent":         { ... },
  "model":         { ... },
  "inputs":        { ... },
  "tools":         [ ... ],
  "locals":        [ ... ],
  "model_context": [ ... ],
  "react":         { ... },
  "generation":    { ... },
  "output":        { ... },
  "assumptions":   [ ... ]
}
```

Required fields, regardless of pattern: `version`, `agent`, `model`,
`inputs`, `tools`, `locals`, `model_context`, `generation`, `output`.

Optional fields: `pattern` (defaults to `"linear"`), `assumptions`.

Pattern-specific fields:

| Pattern | Required pattern block | Forbidden pattern blocks |
|---------|------------------------|--------------------------|
| `"linear"` | none | `react` |
| `"react"` | `react` | (none yet — future patterns added here) |

`version` must be the string `"0.1"`. Future schema changes will bump this
version. Validators reject unknown versions.

## `agent`

Identifies the agent.

```json
{
  "agent": {
    "name": "DocsAssistant",
    "role": "Documentation assistant",
    "description": "Answer questions from documentation with citations."
  }
}
```

| Field | Type | Lowering |
|-------|------|----------|
| `name` | identifier matching `/^[A-Z][A-Za-z0-9_]*$/` | `main agent <name>` |
| `role` | non-empty string | `role "<role>"` |
| `description` | non-empty string | `description "<description>"` |

Phase 1 generates a single `main agent`. Multi-agent specs are out of scope.

## `model`

Specifies the LLM provider.

```json
{
  "model": {
    "import_name": "Qwen",
    "uri": "ollama://localhost:11434/qwen3.6"
  }
}
```

| Field | Type | Lowering |
|-------|------|----------|
| `import_name` | identifier matching `/^[A-Za-z_][A-Za-z0-9_]*$/` | `import llm <import_name>` |
| `uri` | non-empty string | `import llm ... from "<uri>"` |

The compiler emits one `import llm` line. The `import_name` then becomes the
`model` config value of the generated agent. The same model is used for every
`generate` call (including ReAct's reason step).

## `inputs`

Declares the entry function input contract.

```json
{
  "inputs": {
    "message": { "type": "string", "required": true },
    "customer_id": { "type": "string", "required": true }
  }
}
```

Keys are input field names matching `/^[A-Za-z_][A-Za-z0-9_]*$/`. Values
declare the type. Phase 1 treats every input as required; the `required`
field is accepted but has no effect on lowering.

`inputs` lowers to a contract block on `main func`:

```agentscript
main func(input {
    message: string
    customer_id: string
}) { ... }
```

Field order in the generated source follows the JSON object key order.

`inputs` must contain at least one field.

## `tools`

Declares tool imports and the methods the spec uses.

```json
{
  "tools": [
    {
      "import_name": "Docs",
      "uri": "mcp://support-docs",
      "methods": [
        { "name": "search", "purpose": "Search support documentation." }
      ]
    }
  ]
}
```

Each entry has:

| Field | Type | Lowering |
|-------|------|----------|
| `import_name` | identifier matching `/^[A-Za-z_][A-Za-z0-9_]*$/` | `import tool <import_name>` |
| `uri` | non-empty string | `import tool ... from "<uri>"` |
| `methods` | non-empty array | not lowered (validator only) |

Each method has:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | identifier matching `/^[A-Za-z_][A-Za-z0-9_]*$/` | reference target for `locals[*].source` and `react.act` |
| `purpose` | non-empty string | documentation only |

Methods are not lowered to imports or any other source construct. They exist
so the validator can check that every tool method invocation declares which
method it intends to call. This catches typos before runtime.

The compiler emits one `import tool` line per entry, in array order.

## `locals`

Declares pre-loop intermediate values computed by tool calls. In `linear`
specs these are the only tool calls. In `react` specs they run once before
the loop starts (e.g. an initial document retrieval).

```json
{
  "locals": [
    {
      "name": "refund_docs",
      "source": {
        "kind": "tool_call",
        "tool": "Docs",
        "method": "search",
        "args": { "query": "input.message" }
      }
    }
  ]
}
```

Each entry has:

| Field | Type | Notes |
|-------|------|-------|
| `name` | identifier matching `/^[A-Za-z_][A-Za-z0-9_]*$/` | local variable name |
| `source.kind` | literal `"tool_call"` | only kind in Phase 1 |
| `source.tool` | string | must match a `tools[*].import_name` |
| `source.method` | string | must match a method on that tool |
| `source.args` | object | passed to the tool call |

Phase 1 supports a single source kind: `tool_call`. Future kinds (e.g.
`literal`, `derived`) may be added.

`args` keys must match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Values are expression
strings:

| Value form | Lowering |
|------------|----------|
| `"input.<field>"` | `input.<field>` (identifier expression) |
| `"local.<name>"` | `<name>` (the `local.` prefix is stripped) |
| anything else | string literal via `JSON.stringify` |

Local order matters. A local that references `local.X` must appear after
local `X`. The validator reports `FORWARD_LOCAL_REF` when this rule is
broken.

`locals` may be an empty array (e.g. for a pure ReAct agent that does all
its work inside the loop).

Each `locals` entry lowers to one assignment statement:

```agentscript
refund_docs = Docs.search({
    query: input.message
})
```

Locals are emitted in array order, with one blank line between assignments.

## `model_context`

Declares which values enter the model prompt. This is the audit point of the
entire spec: anything not listed here is invisible to the model.

```json
{
  "model_context": [
    { "source": "input.message", "label": "user message" },
    { "source": "local.refund_docs", "label": "support documentation", "max": "8k" }
  ]
}
```

Each entry has:

| Field | Type | Notes |
|-------|------|-------|
| `source` | `"input.<field>"` or `"local.<name>"` | reference must resolve |
| `label` | non-empty string | becomes the `as` label literal |
| `max` | optional string matching `/^\d+k?$/` | becomes the `max` budget |

Each entry lowers to one `use` statement, in array order:

```agentscript
use input.message as "user message"
use refund_docs max 8k as "support documentation"
```

`source` resolution is the same as in `locals[*].source.args`:

- `"input.<field>"` → `input.<field>`
- `"local.<name>"` → `<name>`

Other forms are not allowed in `model_context`. Free-form expressions are
not expressible in Phase 1; users who need them should hand-write `.as`.

`model_context` must contain at least one entry.

`local.<name>` references must resolve to a declared local. References to
locals that exist but are not in `model_context` are valid; this is how the
spec expresses "compute this value but do not show it to the model".

In `react` specs, `model_context` is the **outer** context. It is visible to
both the reason generate (inside the loop) and the final generate. The
ReAct `scratch` is automatically `use`d in the same outer scope using the
label and budget declared in `react.scratch`.

## `generation`

Declares the **final** LLM call (after the loop in ReAct, the only call in
linear).

```json
{
  "generation": {
    "input": "Answer the customer from the provided context. Cite policy claims.",
    "max_output": 1200
  }
}
```

| Field | Type | Lowering |
|-------|------|----------|
| `input` | non-empty string | `generate({ input: "..." })` |
| `max_output` | optional positive integer | `generate({ ..., max_output: N })` |

Phase 1 supports only `input` and `max_output`. Other `generate` options
(`attempts`, `temperature`, `think`, `strict`, `debug`) are not exposed
through AgentSpec; users who need them should hand-write `.as`.

## `output`

Declares the final `generate` output contract.

```json
{
  "output": {
    "fields": {
      "answer": { "type": "string" },
      "citations": { "type": "list[json]" },
      "confidence": { "type": "number" },
      "missing_information": { "type": "list[string]" }
    }
  }
}
```

`fields` keys match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Each value declares the
type.

`output.fields` must contain at least one field.

`output` lowers to a contract block after the final `generate`:

```agentscript
return generate({
    input: "...",
    max_output: 1200
}) -> {
    answer: string
    citations: list[json]
    confidence: number
    missing_information: list[string]
}
```

Field order follows JSON object key order.

## `react` (ReAct pattern)

Required when `pattern == "react"`. Declares the iterative
reason → act → observe loop.

```json
{
  "react": {
    "max_iterations": 6,
    "scratch": {
      "label": "observations",
      "max": "4k"
    },
    "reason": {
      "input": "Look at the observations so far. Pick the next focused query, or set done=true if you can answer.",
      "max_output": 400,
      "output": {
        "fields": {
          "focus": { "type": "string" },
          "done": { "type": "boolean" }
        }
      }
    },
    "act": {
      "tool": "Search",
      "method": "query",
      "args": { "q": "thought.focus" }
    },
    "stop_when": "thought.done"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `max_iterations` | positive integer | Lowers to `loop until done max <N>`. |
| `scratch.label` | non-empty string | Label on the `use scratch.summary` statement. |
| `scratch.max` | string matching `/^\d+k?$/` | Budget on the `use scratch.summary` statement. |
| `reason.input` | non-empty string | The reason `generate` instruction. |
| `reason.max_output` | optional positive integer | Reason `generate` budget. |
| `reason.output.fields` | non-empty object | Reason output contract. Same shape as top-level `output.fields`. |
| `act.tool` | string | Must match a `tools[*].import_name`. |
| `act.method` | string | Must match a method on that tool. |
| `act.args` | object | Args for the act tool call. |
| `stop_when` | string `"thought.<field>"` | Required. `<field>` must be a `boolean` field declared in `reason.output.fields`. |

### Expression strings in `react.act.args`

`args` values support three forms:

| Value form | Resolution |
|------------|------------|
| `"input.<field>"` | refers to the `main func` input |
| `"local.<name>"` | refers to a pre-loop local |
| `"thought.<field>"` | refers to a field of the most recent reason output |
| anything else | JSON string literal |

`thought` is the name the compiler uses for the reason output binding inside
the loop body. Other identifiers (`scratch`, `done`, `obs`) are reserved
inside the loop scope and may not appear as expression roots.

### Lowering

The compiler emits, in order:

1. Imports and agent declaration (shared with linear).
2. `main func(input { ... }) {`.
3. `locals` assignments (shared; pre-loop tool calls).
4. `use` statements for `model_context` (shared with linear).
5. `scratch = []`.
6. `use scratch.summary max <react.scratch.max> as "<react.scratch.label>"`.
7. `done = false`.
8. ```
   loop until done max <react.max_iterations> {
       thought = generate({
           input: "<react.reason.input>",
           max_output: <react.reason.max_output>   // omitted if absent
       }) -> {
           <reason.output.fields lowered like top-level output>
       }

       obs = <react.act.tool>.<react.act.method>({
           <args lowered>
       })
       scratch.add(obs)
       done = <stop_when lowered to identifier>
   }
   ```
9. `return generate({ ... }) -> { ... }` from `generation` and `output`
   (shared with linear).

`stop_when: "thought.done"` lowers to `done = thought.done`. The validator
guarantees `<field>` is a boolean field in `reason.output.fields`.

### Phase 1 ReAct restrictions

- Exactly one `act` tool call per iteration. Multi-step act (act tool
  selection from a list, or zero-tool iterations) is not in Phase 1.
- `stop_when` is required. Pure max-iteration loops without an early-exit
  condition are out of scope. (Use a different pattern in Phase 2 if needed.)
- `scratch` is a flat list of observations. Structured scratch (objects,
  per-iteration metadata) is out of scope.

## Type system

AgentSpec types map directly to AgentScript contract types:

| AgentSpec type | AgentScript contract type |
|----------------|---------------------------|
| `"string"` | `string` |
| `"number"` | `number` |
| `"boolean"` | `boolean` |
| `"json"` | `json` |
| `"list[string]"` | `list[string]` |
| `"list[number]"` | `list[number]` |
| `"list[boolean]"` | `list[boolean]` |
| `"list[json]"` | `list[json]` |

These are the only types Phase 1 supports, both for input/output contracts
and for `react.reason.output.fields`. Nested object contracts, named custom
types, and optional fields are not expressible. Use `json` or `list[json]`
for values that need richer structure.

This restriction follows the AgentScript contract type system, which is
intentionally narrow. AgentSpec does not extend it.

## `assumptions`

An optional list of free-form strings that document design decisions made
during spec authoring.

```json
{
  "assumptions": [
    "If documentation is insufficient, fill missing_information.",
    "Citations are required for factual claims."
  ]
}
```

Assumptions are not lowered to source. They serve as the spec author's
checklist: things the LLM-generated spec assumed but the user might want to
revise. Tools may surface assumptions in review UIs.

## Validation rules

A validator must check every spec before compilation. Phase 1 validation
covers:

### Schema check

- Required fields present.
- `version` equals `"0.1"`.
- Identifiers match the patterns documented above.
- Required strings are non-empty.
- `inputs`, `tools[*].methods`, and `output.fields` are non-empty.
- `locals[*].source.kind` is `"tool_call"`.
- `args` and `output.fields` keys match identifier patterns.

### Pattern check

- `pattern` (if present) is one of `"linear"` or `"react"`. Other values
  return `UNSUPPORTED_PATTERN`. Omitted `pattern` is treated as `"linear"`.
- The required pattern block is present, and forbidden pattern blocks are
  absent. Error codes: `MISSING_PATTERN_BLOCK`, `UNEXPECTED_PATTERN_BLOCK`.

### Type check

Every `type` value belongs to the supported set, both in `inputs`,
`output.fields`, and `react.reason.output.fields`.

### Tool reference check

Every `locals[*].source.tool` and `react.act.tool` resolves to a declared
tool, and the corresponding `method` resolves to a method on that tool.

### Reference check

Every `"input.<field>"` reference (in `args`, `model_context`, and
`react.act.args`) resolves to a declared input. Every `"local.<name>"`
reference resolves to a declared local. Forward references inside `locals`
are rejected.

### React-specific checks

When `pattern == "react"`:

- `react.max_iterations` is a positive integer.
- `react.scratch.label` is non-empty; `react.scratch.max` matches
  `/^\d+k?$/`.
- `react.reason.output.fields` is non-empty and types are supported.
- `react.act.tool` and `react.act.method` resolve.
- `react.act.args` values follow the three-form rule. `"thought.<field>"`
  references must resolve to a field declared in `react.reason.output.fields`.
  Error code: `UNKNOWN_THOUGHT_REF`.
- `react.stop_when` is the literal form `"thought.<field>"` where `<field>`
  is a `boolean` field declared in `react.reason.output.fields`. Error
  codes: `INVALID_STOP_WHEN`, `UNKNOWN_THOUGHT_REF`,
  `STOP_WHEN_NOT_BOOLEAN`.
- The identifiers `thought`, `obs`, `scratch`, and `done` are reserved by
  the ReAct lowering. They may not appear as keys in `inputs`, names in
  `locals`, keys in `output.fields`, or keys in
  `react.reason.output.fields`. Error code: `RESERVED_IDENTIFIER`. Linear
  specs are not subject to this restriction.

### Model context check

`model_context` is non-empty. Every `source` resolves. Every `label` is
non-empty. Every `max` (if present) matches `/^\d+k?$/`.

The validator does not check:

- whether URIs are reachable
- whether tool method signatures match the runtime
- the semantic content of `generation.input` or `react.reason.input`
- policy or safety constraints

## Compilation

The compiler is a deterministic function. Same input produces same output.
The compiler does not call the LLM.

Algorithm:

1. Run the validator. If there are any error-level diagnostics, refuse to
   compile.
2. Emit `import llm` for `model`.
3. Emit one `import tool` for each `tools` entry, in array order.
4. Emit `main agent <name> {` plus `model`, `role`, `description` config
   lines.
5. Emit `main func(input { ... }) {`.
6. Emit `locals` as assignment statements, in array order, separated by
   blank lines.
7. Emit `model_context` as `use` statements, in array order.
8. Dispatch on `pattern`:
   - `"linear"`: emit
     `return generate({ ... }) -> { ... }` from `generation` and `output`.
   - `"react"`: emit `scratch = []`, the scratch `use` statement,
     `done = false`, the `loop until done max N { ... }` block per the
     ReAct lowering, and finally the `return generate(...) -> { ... }` from
     `generation` and `output`.
9. Close all open braces.

String literals are emitted via JSON-style escaping (equivalent to
`JSON.stringify`). The generated source must pass the current parser and
semantic analyzer.

## Limitations

Phase 1 deliberately does not support:

- Patterns other than `"linear"` and `"react"`.
- Generic `stages` with a free-form expression language (planned as a
  future pattern).
- Conditional branches (`if` / `else`) inside `main func`.
- Multiple loops, nested loops, or `parallel for`.
- Multiple ReAct iterations with different tool selections per step.
- Multiple functions per agent.
- Multiple agents per spec.
- Agent-to-agent calls.
- `use one of` candidate slots.
- memory imports (`import memory`).
- file imports (`import file`).
- agent imports (`import agent`).
- `use` of capability-bound names.
- non-tool-call locals (literals, computed expressions, member access).
- nested object contracts.
- optional input fields.

Specs that need these features should be hand-written, or the user should
extend the generated source after compilation. Future versions of AgentSpec
may expand coverage by introducing new patterns.

## Related documents

- [AgentScript Language](./language.md) — full language reference.
- [`use ... as ...`](./use-as.md) — context selection rules.
- [`generate`](./generate.md) — generation site rules and output contracts.
- [Optimizer Toolchain](./optimizer.md) — `host://optimizer` for variant
  selection on existing programs.
