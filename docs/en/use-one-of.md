# `use one of ...`

This document defines how `use one of` declares multiple candidate sources at a single context slot, turning the selection itself into a learnable, optimizable variable.

For the base model of context selection see [`use ... as ...`](./use-as.md). For the overall design rationale see [Context Engineering](./context-engineering.md).

## Purpose

`use one of` is not a separate prompt mechanism. It is a focused extension of `use`: a single `use` declaration may bind **multiple candidate sources**, and named variants give authors and optimizers a shared contract for how the choice is made.

```text
use one of {
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    grounded: scratch.summary max 2k selected
} as "evidence"
```

It means:

```text
This context slot is a learnable choice point.
Candidates are parallel alternatives; exactly one is used as "evidence" at any time.
The trailing `selected` marks the default-picked candidate; without it, the first candidate is picked.
```

It addresses a specific problem: **agent quality is dominated by context organization, not by prompt wording**. Promoting "which context to include" to a first-class learnable variable puts the optimizer in a structured, enumerable, cross-model-stable search space, instead of optimizing fragile prompt text.

## Recommended syntax

```text
use one of {
    name1: expr1
    name2: expr2 max budget2
    name3: expr3 max budget3 selected
    name4: empty
} as label
```

Each variant has a fixed form:

```text
identifier ":" (use-expression | "empty") [ "selected" ]
```

Where `use-expression` follows the same form as the portion of an ordinary `use` before `as label` (`expr` or `expr max budget`). Variants are separated by newlines, matching contract block conventions.

The trailing `selected` is an optional single-word modifier placed after the candidate value. It explicitly marks the default-picked candidate. A `use one of` may contain at most one `selected`.

Full example:

```text
main agent Researcher {
    model Qwen
    role "Senior Researcher"
    description "Answer with selected evidence."

    main func(input { question: string }) {
        lessons = Lessons.query({ kind: "how-to" })
        docs = Search.search(input.question)

        use input.question as "user question"

        use one of {
            none:        empty
            lesson_only: lessons max 2k
            doc_only:    docs.summary max 4k
            combined:    [lessons, docs.top3] max 4k selected
        } as "evidence"

        generate({ input: "Answer from evidence" }) -> {
            ok: boolean
            answer
        }
    }
}
```

Here `evidence` has four possible variants: nothing, lessons only, search docs only, or a combination. The author marks `combined` as `selected`, meaning "without further signal, default to combined". An optimizer may later move `selected` to a different candidate, or inject new candidates and relabel.

## Relation to plain `use`

The semantics of `use one of` **is still `use`**. It only binds multiple candidates at the declaration site; at runtime a single candidate is chosen (either explicitly or by default), and the net effect is equivalent to an ordinary `use`—or, when the picked candidate is `empty`, equivalent to declaring no `use` at that site at all.

All ordinary `use` semantics therefore continue to hold:

- `as label` is still the context section label, not an expression.
- Evaluation is still deferred until a visible `generate` constructs its prompt.
- Scope rules are unchanged—`use one of` at agent / function / block level has the same visibility as a plain `use` at that level.
- The picked candidate must still obey the "no runtime capability" rule (tool / llm / agent / memory / function bindings cannot appear as the root of a candidate expression).

The reverse reading is also true: **every plain `use` can be viewed as a single-candidate special case of `use one of`**. This is a mental model only; the language does not force rewriting.

## Constraints on candidates

All candidates within a single `use one of { ... }` **must satisfy the following**:

### Shared label

The label is written after `}` and is shared by every candidate:

```text
use one of {
    compact: scratch.digest max 500
    verbose: scratch.summary max 4k
} as "evidence"
```

Candidates **cannot** carry their own `as ...`:

```text
// Illegal
use one of {
    compact: scratch.digest max 500 as "short-evidence"    // NO
    verbose: scratch.summary max 4k as "long-evidence"     // NO
} as "evidence"
```

Reason: `use one of` reinforces the mental model "one context slot, multiple sources". The label names the slot's role for `generate`; variants change *what data* fills it, not *what role it plays*.

### Per-candidate budget

Each candidate may declare its own `max budget`:

```text
use one of {
    compact: scratch.digest max 500
    verbose: scratch.summary max 4k
} as "evidence"
```

The budget is part of the candidate—different candidates typically imply different size preferences. A candidate without a budget follows the plain-`use` rule: unlimited by context item budget.

### `empty` variants

A candidate slot may be written as the reserved word `empty`, meaning **when this variant is picked, no context is declared at this site**:

```text
use one of {
    none: empty
    verbose: scratch.summary max 4k
} as "evidence"
```

Semantics:

- When the `none` variant is picked, the `use one of` is **as if absent** for visible `generate` calls—no `evidence` section is injected into the prompt and no context item is produced.
- When `verbose` is picked, behavior is exactly equivalent to `use scratch.summary max 4k as "evidence"`.

`empty` may only appear in the candidate value slot of `use one of { ... }`; it cannot appear in other expression positions, nor combine with `max budget` or `as label`. `empty` may carry `selected`: `none: empty selected` is legal and means "the author defaults to not adding this context".

### The `selected` modifier

A candidate may be followed by the keyword `selected` to mark it as the default pick:

```text
use one of {
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k selected
    grounded: scratch.summary max 2k
} as "evidence"
```

Rules:

- A `use one of` may contain **at most one** candidate with `selected`. Two `selected` markers is a semantic error.
- `selected` is a trailing single-word modifier after the candidate value (`expr` / `expr max budget` / `empty`).
- When no candidate is marked `selected`, the **first candidate** is picked by default. See "Variant selection".
- `selected` may be attached to an `empty` candidate: `none: empty selected` is legal.
- `selected` governs the default pick only; a runtime hint in trial mode overrides it.

Why `selected` exists:

- **Explicit author intent**: the author can mark the default without relying on source order.
- **Optimizer-friendly diff**: optimizer output only needs to move `selected` from one candidate to another. The diff is one token.
- **Visual clarity**: readers see at a glance which candidate is currently in effect, without counting positions.

### `none` as a naming convention for `empty` variants

The variant name (left of `:`) is a user-chosen identifier. Recommended convention:

- **`none`** as the name for an `empty` variant (visually matches AgentScript's `none` null literal).
- `skip` / `off` / `omit` are also acceptable; the language does not enforce.

```text
// Recommended
use one of {
    none: empty
    long: scratch.summary max 4k
} as "evidence"

// Legal but not recommended
use one of {
    skip: empty
    long: scratch.summary max 4k
} as "evidence"
```

Variant names are **local** to their `use one of`—they do not enter any scope, do not shadow outer bindings, and cannot be referenced elsewhere. Multiple `use one of` sites in the same agent may reuse the same variant names.

### Candidate types do not need to match

Candidate expressions are **not required to share a type**. One candidate may return a string, another a list, another an object, and another may be `empty`. All non-empty candidates flow through the same `use` sanitize and render pipeline and are emitted into the prompt as JSON-safe values.

### Candidate count

At least 2 candidates are required. `empty` counts as a candidate, so `{ none: empty, long: X }` is the legal minimum.

```text
// Illegal: only one candidate
use one of {
    only: scratch.summary max 4k
} as "evidence"
```

A `use one of` without choice space is pointless; the parser rejects it and directs the author to write `use X as L` instead.

## Variant selection

Before every visible `generate` builds its prompt, each visible `use one of` must resolve to a **single candidate**. Priority (highest to lowest):

1. **Runtime hint**: `ExecuteOptions.variant` carries a per-site map of variant names (used by the optimizer agent during trials).
2. **Source `selected`**: the candidate list marks one candidate with `selected`.
3. **First candidate**: neither a runtime hint nor `selected` is present; the first candidate in source order is picked.

The ordering matters because runtime hints must be able to **override** `selected`. When an optimizer performs trials, it enumerates candidates—if `selected` could not be overridden, trials could only run the marked candidate and the search would be a no-op.

These three rules together ensure:

- An unoptimized `.as` file has fully deterministic runtime behavior (`selected` if present, otherwise first).
- Optimizers need no runtime surface beyond the hint map; final "winners" are persisted by source-to-source rewriting that moves `selected`.
- Audit traces always record which candidate was picked and why.

Authoring conventions:

- To default to "no context here": use `none: empty selected`, or place `none: empty` first.
- To default to a conservative version: add `selected` to that candidate, or place it first.
- Prefer `selected` over positional conventions: it states intent explicitly and survives reorder.

## Specialization

The optimizer's output is a **concrete `.as` file**. Two equivalent forms exist:

### Structure-preserving specialization (recommended)

The optimizer keeps the full `use one of` structure and only moves `selected` to the winning candidate:

```text
// Before
use one of {
    none:     empty
    compact:  scratch.digest max 500 selected
    verbose:  scratch.summary max 4k
    grounded: scratch.summary max 2k
} as "evidence"

// After: selected moved to grounded
use one of {
    none:     empty
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    grounded: scratch.summary max 2k selected
} as "evidence"
```

The diff is one `selected` move plus optional evaluation comments:

```text
use one of {
    none:     empty
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    // picked 2026-05-11 against fixtures/evidence-eval.json (F1 0.82, baseline 0.71)
    grounded: scratch.summary max 2k selected
} as "evidence"
```

This form keeps the site marked as a choice point, preserving every candidate, so the program **can be re-optimized** (new candidates injected, `selected` re-moved after new trials). It is the recommended default output.

### Flattened specialization

The optimizer collapses `use one of` into a plain `use`:

```text
// Flattened
use scratch.summary max 2k as "evidence"  // optimizer: grounded variant (F1 0.82)
```

If the optimizer picks the `empty` variant, the flattened form **removes the `use` entirely**:

```text
// Before
use one of {
    none: empty selected
    long: scratch.summary max 4k
} as "evidence"

// Flattened (optimizer kept none)
// The use is removed here.
```

This form reads like ordinary hand-written AgentScript and is suitable as a final production artifact, but loses the "this was a choice point" signal and cannot be re-optimized.

Both forms are legal `.as` source. The optimizer toolchain may choose; structure-preserving should be the default. The language itself only requires the output to be syntactically valid.

## Scope visibility

`use one of` follows the same scope rules as `use`:

- **Agent-level**: declared at the top of an agent body (alongside `model` / `role`), visible to every function of that agent.
- **Function-level**: declared in a function body, visible to that function and its block sub-scopes.
- **Block-level**: declared inside `if` / `for` / `loop` / `repeat` / `parallel for` bodies, visible only within the block.

Agent-level `use one of` follows the same constraints as agent-level `use`—candidates may reference only names resolvable at the agent top level (typically `import file`), cannot depend on function parameters or locals, and cannot contain call expressions. The following is valid:

```text
import file ShortPlaybook from "./playbook.short.md"
import file LongPlaybook  from "./playbook.long.md"

main agent Researcher {
    model Fast
    role "Researcher"
    description "Answer with playbook discipline."

    use one of {
        none:  empty
        short: ShortPlaybook selected
        long:  LongPlaybook max 4k
    } as "playbook"

    main func(input) {
        generate({ input: input.question }) -> { text }
    }
}
```

Agent-level `use one of` is a **declarative** choice point that participates in agent identity, alongside `role`. Specializations of Researcher effectively represent different personas—the same question, answered with a shorter or longer playbook, or no playbook at all.

## What cannot appear as a candidate

Runtime capabilities still cannot appear as the root of any candidate expression:

```text
// Illegal: tool / memory / llm / agent / function binding is not prompt context
use one of {
    cached: lessons max 2k
    live:   Search.search(input.question)   // Search is a tool binding, Search.search(...) is a call
} as "evidence"
```

The reasons are the same as for plain `use`:

- Candidates may reference *data*, not capabilities or direct capability calls.
- For dynamic data, use the "call then use" pattern: store the call result in a local, then reference the local as a candidate.

```text
// Legal
live_docs = Search.search(input.question)

use one of {
    none:   empty
    cached: lessons max 2k
    live:   live_docs max 4k selected
} as "evidence"
```

## Prompt rendering

A picked non-empty candidate renders exactly like an ordinary `use`:

```text
Context:
[evidence]
source: scratch.summary
[
  { "fact": "..." }
]
```

A picked `empty` variant **renders no section**—equivalent to the `use one of` not appearing in source at all. `source` uses the text of the picked candidate's expression. The prompt **does not expose** variant names, candidate count, or which candidate carried `selected`. This guarantees:

- The prompt the model sees is always "one context slot, one source"—unaffected by optimization state.
- The same agent before and after optimization produces prompts with identical structure; only the picked source (or its absence) changes.
- Cross-model migration does not destabilize due to prompt-structure drift.

## Trace requirements

The `use one of` trace event extends the plain `use` event with variant selection information.

Non-empty variant picked:

```json
{
  "kind": "use",
  "data": {
    "source": "scratch.summary",
    "label": "evidence",
    "budget": { "amount": 2, "unit": "k" },
    "variant": {
      "site_id": "research.as#Researcher.main[evidence]",
      "picked": "grounded",
      "available": ["none", "compact", "verbose", "grounded"],
      "reason": "selected",
      "empty": false
    }
  }
}
```

`empty` variant picked:

```json
{
  "kind": "use",
  "data": {
    "source": null,
    "label": "evidence",
    "budget": null,
    "variant": {
      "site_id": "research.as#Researcher.main[evidence]",
      "picked": "none",
      "available": ["none", "compact", "verbose", "grounded"],
      "reason": "first",
      "empty": true
    }
  }
}
```

`variant.reason` records the selection source:

- `"trial"` — supplied via `ExecuteOptions.variant`.
- `"selected"` — a candidate in source carried `selected`.
- `"first"` — neither a trial hint nor `selected` was available; the first candidate was picked.

The `generate` event's built context items do not grow new fields—they still record "the source and value that actually entered the prompt". A `use one of` that resolved to `empty` produces no context item at all. The variant detail lives on the `use` event and is sufficient for external tooling to reconstruct the full variant combination used by any given `generate`, including slots that were deliberately skipped.

`variant.site_id` is an implementation-defined site identifier used by trial-time `ExecuteOptions.variant` hints and trace correlation. The current implementation uses a label-based format: `<path>#<agent>.<func>[<label>]`; agent-level context omits the function segment. It is not a durable optimization artifact: persisted optimization should rewrite source by moving `selected`, while the runtime hint map is intended for executions against the same parsed source.

## Optimizer contract

The optimizer is not part of the language core. It is a user-space agent or script that interacts with `use one of` through two contracts:

1. **Read**: parse `.as` source, enumerate all `use one of` sites and their candidate names (including `empty` candidates), as the search space. Optionally read each site's current `selected` candidate as a baseline.
2. **Write**: run the program (trials) for each candidate combination, evaluate, and produce a specialized `.as`—structure-preserving output with `selected` moved to the winning candidate is recommended.

The runtime provides only two minimal hooks:

- `ExecuteOptions.variant`: an execution may pass a `{ site_id: variant_name }` map so that a `use one of` at a given site uses a specific candidate during trials. This map **overrides any `selected` in source**. The current `site_id` uses `<path>#<agent>.<func>[<label>]`.
- The `variant` field on `use` trace events: the optimizer can reconstruct which candidate actually ran per trial, whether it was empty, and how it was chosen.

Together these keep "optimization" as a pure source-to-source function: `.as` + evaluation signal → new `.as` (candidate set unchanged; `selected` may move). The runtime only ever executes concrete programs and does not observe the optimization process.

Evaluation signals (fixtures, memory, LLM-as-judge, and so on) are arranged entirely by the optimizer agent; they are not a language feature.

## Design checklist

Before changing or using `use one of`, verify that:

- At least 2 candidates are present. `empty` counts as one, but a single-candidate form (including a lone `empty`) is still illegal.
- The label is shared—written after `}`, not inside any candidate.
- `empty` appears only in candidate value slots, not elsewhere.
- `selected` appears at most once and only as a trailing modifier on a candidate value.
- Without `selected`, the first candidate is deterministically picked, and the first candidate reflects the author's intended default.
- A runtime hint can override `selected` during trials.
- Candidate expressions still never reference a runtime capability as their root.
- `use one of` scope rules match plain `use`.
- Traces record variant picks, the candidate list, the `empty` flag, and the selection reason.
- Specialized source remains legal AgentScript. When `empty` is picked, the flattened form removes the `use` entirely.
- The prompt structure seen by the model does not shift with optimization state.

## Design intent

`use` promotes prompt context selection to a first-class language concept. `use one of` extends the same primitive with one more axis: **the selection itself is a learnable variable**.

- No new primitive is introduced for optimization: the core is still `use` and `generate`.
- No new syntactic modifier is introduced for "include or skip a context"; that dimension is expressed by an ordinary `empty` variant, unifying both axes under one mechanism.
- The optimized diff is a single `selected` move—minimal, readable, auditable.
- The search space is **structured, enumerable, and cross-model stable**—choosing between A, B, or none is far more stable than optimizing prompt wording.
- Unoptimized programs are fully deterministic at runtime—the `selected` candidate, or the first candidate, is the author's default.
- Optimization output is ordinary AgentScript source—audit, diff, version control, and re-optimization reuse existing tools.
- The optimizer is not a framework component but a user-space agent—built from `use` / `generate` / `memory` / `parallel for` like any other AgentScript program.

This gives AgentScript a crisp line:

```text
Agent context as code, and learnable context selection as code.
Learning does not hide in runtime. Learning produces code.
```
