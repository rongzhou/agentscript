# Default String Fields in `generate` Output Shapes

This document specifies the default string shorthand for `generate` output shapes in AgentScript.

For the broader `generate` semantics, see [`generate`](./generate.md). For the compact language reference, see [AgentScript Language](./language.md).

## Purpose

LLM structured output often contains many text fields.

Current explicit syntax:

```agentscript
generate({
    input: "Summarize the file",
    max_output: 1000
}) -> {
    title string
    summary string
    key_points list[string]
    action_items list[string]
}
```

This is clear, but repetitive when most fields are strings.

The default string shorthand allows string fields in `generate` output shapes to omit the `string` annotation:

```agentscript
generate({
    input: "Summarize the file",
    max_output: 1000
}) -> {
    title
    summary
    key_points list[string]
    action_items list[string]
}
```

The shorthand is equivalent to the explicit form above.

## Design principle

```text
Generated text is string by default.
External input is explicit by default.
```

`generate` output shapes are optimized for LLM ergonomics. External input contracts remain explicit because they describe data entering the program from outside.

## Scope

The rule applies only inside the output shape of a `generate` expression.

Allowed:

```agentscript
generate({ input: "Answer" }) -> {
    answer
    rationale
}
```

Equivalent to:

```agentscript
generate({ input: "Answer" }) -> {
    answer string
    rationale string
}
```

The rule does not apply to input shapes, function parameter shapes, imported data schemas, or future general type declarations.

Invalid:

```agentscript
main func(input {
    path
}) {
}
```

Required:

```agentscript
main func(input {
    path string
}) {
}
```

## Syntax

Inside a `generate(...) -> { ... }` output shape, a field may be written in either explicit or shorthand form:

```agentscript
field_name type
field_name
```

A shorthand field is normalized to:

```agentscript
field_name string
```

Example:

```agentscript
generate({ input: "Classify the issue" }) -> {
    category
    confidence number
    urgent boolean
    reasons list[string]
}
```

Resolved output contract:

```text
category string
confidence number
urgent boolean
reasons list[string]
```

## Field termination

A missing type is recognized only when the field name is followed by a field boundary.

Field boundaries are:

```text
newline
comma
closing brace
```

Valid:

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
}
```

Also valid if comma-separated shape fields are supported by the parser:

```agentscript
generate({ input: "Summarize" }) -> {
    title,
    summary,
}
```

If another identifier appears on the same line after a field name, it is treated as an explicit type and must be a supported shape type.

Invalid:

```agentscript
generate({ input: "Classify" }) -> {
    confidence nubmer
}
```

Diagnostic:

```text
Unsupported shape type 'nubmer'
```

The parser must not interpret this as:

```text
confidence string
nubmer string
```

## Normalization

After parsing and semantic analysis, every shape field has an explicit resolved type.

Source:

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
    key_points list[string]
}
```

Resolved shape:

```text
title string
summary string
key_points list[string]
```

Runtime validation, provider schemas, retries, and trace output operate on the resolved shape.

## Trace and debug output

Trace and debug output should display the resolved output contract, not an ambiguous source-level shorthand.

Source:

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
}
```

Trace display:

```text
Output shape:
  title string
  summary string
```

This keeps generated output contracts explicit and auditable.

## Non-goals

This rule does not add:

```text
global default string types
implicit input types
optional fields
default values
schema inference
type aliases
computed field names
```

It only shortens common string fields in `generate` output shapes.

## Recommended style

Use shorthand for ordinary generated text fields:

```agentscript
generate({ input: "Summarize the document" }) -> {
    title
    summary
    key_points list[string]
    action_items list[string]
}
```

Use explicit types for non-string fields:

```agentscript
generate({ input: "Classify the issue" }) -> {
    category
    confidence number
    urgent boolean
    reasons list[string]
}
```

Keep input shapes explicit:

```agentscript
main func(input {
    path string
    max_items number
}) {
}
```

## One-sentence definition

```text
In generate output shapes, an untyped field defaults to string; everywhere else, fields require explicit types.
```

## Design checklist

Before changing output shape syntax, verify:

- Does the shorthand apply only to `generate` output shapes?
- Do external input contracts still require explicit types?
- Are typo diagnostics for same-line type names preserved?
- Does runtime validation operate on resolved explicit types?
- Does trace show the resolved output contract?
- Does the rule avoid schema inference, optional fields, and default values?
