# Label-only Contract Fields

This document defines label-only shorthand and the default value rule used by AgentScript contract blocks.

Contract blocks appear only where AgentScript expects a structural contract:

- the first `input` parameter of `main func`
- the output contract after `generate(...) ->`

The object passed to `generate(...)` is not a contract block. It is a JSON-like options object whose `input` field carries the per-call instruction.

## Syntax

A contract field normally uses `label: value`:

```agentscript
main func(input {
    question: string
    limit: number
}) {
    ...
}
```

When the value is omitted, the field is written as label-only. Label-only means `label: default_value`; the default value is defined by the contract's usage site.

Today only `generate(...) -> { ... }` output contracts define a default value, and that default is `string`:

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
    confidence: number
}
```

This resolves to:

```text
title: string
summary: string
confidence: number
```

Do not write a dangling colon for label-only fields. Use `title`, not `title:`.

Input contracts do not define a default value, so they cannot use label-only fields:

```agentscript
main func(input {
    question: string
}) {
    ...
}
```

Likewise, `use one of` candidate blocks do not define a default value. Every candidate must use `label: value`.

## Separators

Contract fields are separated by newlines. Commas are not allowed:

```agentscript
generate({ input: "Extract" }) -> {
    title
    tags: list[string]
}
```

Single-field contracts may remain on one line:

```agentscript
main func(input { path: string }) {
    ...
}
```

Contract blocks are distinct from JSON-like object literals. `generate({ ... })` options use JSON-like comma-separated object syntax; `-> { ... }` uses contract syntax.
