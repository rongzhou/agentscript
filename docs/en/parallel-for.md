# `parallel for`

This document defines `parallel for`, AgentScript's structured parallelism primitive for independent multi-agent, tool, or `generate` work over a bounded list.

For context selection, see [`use ... as ...`](./use-as.md). For generation sites and output contracts, see [`generate`](./generate.md).

## Purpose

AgentScript does not expose a general async system.

It does not define:

```text
async
await
Promise
Task
spawn
join
background jobs
```

Instead, AgentScript provides one structured parallel primitive:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

The purpose is narrow:

```text
run independent iterations concurrently,
collect results in input order,
preserve deterministic trace,
and avoid shared mutable state.
```

This is designed for real AgentScript bottlenecks such as:

```text
multi-agent execution
multi-file review
multi-chunk summarization
multi-step plan execution
multi-result analysis
```

## Recommended syntax

```agentscript
results = parallel for item in items max 10 {
    expression
}
```

Example:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor({
        goal: input.goal,
        step: step
    })
}
```

The loop body must end with a value expression. Each iteration result is collected into a list.

The result order matches the input order, not completion order.

## Basic semantics

Given:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

AgentScript evaluates it as:

```text
1. Evaluate plan.steps once.
2. Take at most 10 items.
3. Start independent iterations.
4. Run iterations concurrently, subject to runtime concurrency limit.
5. Each iteration evaluates the body in an independent child scope.
6. Each iteration returns the value of its final expression.
7. Collect all iteration results into a list.
8. Preserve input order in the returned list.
```

AgentScript does not expose promises or async/await to the language user.

## Comparison with normal `for`

Sequential `for`:

```agentscript
results = []

for step in plan.steps max 10 {
    result = Executor(step)
    results.add(result)
}
```

Semantics:

```text
iterations run one after another
later iterations may depend on earlier state
body may update local state
```

Parallel `for`:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

Semantics:

```text
iterations are independent
iterations may run concurrently
iterations do not share mutable local state
results are collected automatically
```

The difference is not just performance. `parallel for` is a declaration of independence between iterations.

## Result value

`parallel for` is an expression. It returns a list:

```agentscript
results = parallel for file in files max 20 {
    ReviewFile(file)
}
```

If `files` contains:

```json
[
  "a.ts",
  "b.ts",
  "c.ts"
]
```

then `results` corresponds to:

```json
[
  result_for_a,
  result_for_b,
  result_for_c
]
```

The list order always follows the input order. Even if `c.ts` finishes first, its result remains at index `2`.

## Final expression return

The body of `parallel for` must produce a value.

Valid:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

Valid:

```agentscript
results = parallel for step in plan.steps max 10 {
    result = Executor(step)

    {
        step: step,
        result: result
    }
}
```

Invalid:

```agentscript
results = parallel for step in plan.steps max 10 {
    use step as current_step
}
```

Reason:

```text
parallel for body must end with a value expression
```

Invalid:

```agentscript
results = parallel for step in plan.steps max 10 {
    log = Executor(step)
    // no final expression
}
```

The semantic checker should reject a `parallel for` body that cannot produce an iteration value.

## Scope rules

Each iteration runs in an independent child scope.

Example:

```agentscript
use input.goal as goal

results = parallel for step in plan.steps max 10 {
    use step as current_step

    generate({
        input: "Execute this step",
        max_output: 800
    }) -> {
        result
    }
}
```

Rules:

```text
outer visible context may be inherited
each iteration has its own local variables
context declared inside one iteration is local to that iteration
context declared inside one iteration does not leak to other iterations
context declared inside one iteration does not leak outside the parallel for
```

In the example:

```text
goal is visible to all iterations
current_step is different for each iteration
current_step does not leak outside the iteration
```

## Function and agent boundaries

Existing AgentScript boundary rules still apply.

If the body calls an agent:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor({
        goal: input.goal,
        step: step
    })
}
```

then each `Executor(...)` call creates an agent boundary.

The called agent does not automatically inherit the caller's selected context. It sees only its input value and the context selected inside the called agent.

This preserves multi-agent auditability.

## No shared mutable state

`parallel for` iterations may read outer variables, but may not write or mutate outer variables.

Invalid:

```agentscript
count = 0

results = parallel for step in plan.steps max 10 {
    count = step
    Executor(step)
}
```

Invalid:

```agentscript
scratch = []

results = parallel for step in plan.steps max 10 {
    result = Executor(step)
    scratch.add(result)
    result
}
```

Reason:

```text
parallel for iterations must not mutate outer local state
```

Correct:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}

scratch.add(results.summary)
```

The design rule is:

```text
parallel work returns values;
aggregation happens after parallel work completes.
```

This keeps execution deterministic and traceable.

## Tool side effects

AgentScript is conservative about side effects inside `parallel for`.

Read-only tools may be used inside `parallel for`:

```agentscript
read_results = parallel for file in files max 20 {
    read = File.read({ path: file.path })
    read.content
}
```

Effectful tools are rejected unless explicitly marked concurrency-safe by the runtime:

```agentscript
results = parallel for file in files max 20 {
    File.write({
        path: file.output,
        content: "..."
    })
}
```

Recommended error:

```text
Effectful operation File.write is not allowed inside parallel for.
Move the effect outside the parallel block or mark the tool as concurrency-safe.
```

Examples of effectful operations:

```text
File.write
File.patch
File.delete
Memory.add
HTTP POST/PUT/PATCH/DELETE
external command with side effects
```

Examples of normally safe operations:

```text
File.read
File.list
Grep.run
HTTP GET
agent calls
generate calls
```

## `max` semantics

In:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

`max 10` limits how many input items are consumed.

It does not mean concurrency level.

```text
max 10 = process at most 10 items
```

Concurrency is controlled by runtime configuration.

Example:

```bash
agentscript app.as --concurrency 4
```

Recommended default:

```text
concurrency: 4
```

The runtime may also apply provider-specific rate limits.

## Concurrency limit

`parallel for` does not launch unlimited LLM calls.

The runtime executes iterations through a concurrency limiter.

Recommended behavior:

```text
default concurrency = 4
CLI override: --concurrency N
SDK option: concurrency: N
provider adapters may apply stricter limits
```

Example:

```bash
agentscript workflows/review.as \
  --input '{"path":"src"}' \
  --concurrency 3 \
  --trace
```

If there are 10 items and concurrency is 3:

```text
at most 3 iterations run at the same time
results are still returned in input order
trace is still displayed in input order
```

## Error semantics

`parallel for` uses wait-all semantics.

That means:

```text
start all scheduled iterations
wait for all iterations to settle
if all succeed, return list of values
if any fail, the entire parallel for fails
preserve trace for every iteration
```

It does not fail fast.

Reason:

```text
LLM calls are expensive
debugging requires complete branch information
trace shows the full execution state
```

Example failure:

```text
parallel for failed:
- [0] ok, 1820ms
- [1] failed, provider timeout, 5000ms
- [2] ok, 2310ms
```

The failed expression includes diagnostics for every failed iteration.

## Trace requirements

Trace is part of the feature, not an afterthought.

A `parallel for` trace records:

```text
source list expression
item limit
actual item count
runtime concurrency
iteration index
iteration input summary
iteration start/end time
iteration duration
nested trace
iteration success/failure
final result index
```

Pretty trace:

```text
ParallelFor #1 started
  source: plan.steps
  max_items: 10
  items: 3
  concurrency: 3

Iteration [0] started
Iteration [1] started
Iteration [2] started

Iteration [1] completed
  duration: 1840ms
  llm_calls: 1

Iteration [0] completed
  duration: 2310ms
  llm_calls: 1

Iteration [2] completed
  duration: 2680ms
  llm_calls: 1

ParallelFor #1 completed
  duration: 2685ms
  ok: true
```

Display order is deterministic:

```text
trace output is grouped by input index, not completion order
```

A compact deterministic view:

```text
ParallelFor #1 completed
  [0] ok, 2310ms
  [1] ok, 1840ms
  [2] ok, 2680ms
```

## Prompt context interaction

`parallel for` does not automatically add results to prompt context.

Example:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

The results are ordinary data.

They enter a later prompt only if explicitly selected:

```agentscript
use results.summary max 6k as execution_results

generate({
    input: "Summarize execution results",
    max_output: 1200,
    strict: true
}) -> {
    summary
    failures: list[string]
    next_action
}
```

This preserves the core AgentScript invariant:

```text
no implicit prompt capture
```

## Example: plan execution

```agentscript
main agent Controller {
    model Main
    role "Controller"
    description "Plan work, execute independent steps, and summarize the outcome."

    main func(input {
        goal: string
    }) {
        plan = Planner({
            goal: input.goal
        })

        results = parallel for step in plan.steps max 10 {
            Executor({
                goal: input.goal,
                step: step
            })
        }

        use input.goal as goal
        use plan.summary max 2k as plan
        use results.summary max 6k as execution_results

        generate({
            input: "Summarize the execution results and decide the next action.",
            max_output: 1200,
            attempts: 2,
            strict: true,
            think: "medium"
        }) -> {
            summary
            completed: list[string]
            failed: list[string]
            next_action
        }
    }
}
```

This expresses the common pattern:

```text
plan -> parallel execution -> explicit context selection -> final synthesis
```

## Example: multi-file review

```agentscript
main agent RepoReviewer {
    model Main
    role "Repository Reviewer"

    main func(input {
        files: list[json]
    }) {
        reviews = parallel for file in input.files max 20 {
            FileReviewer({
                path: file.path
            })
        }

        use reviews.summary max 8k as file_reviews

        generate({
            input: "Produce a release-readiness review from the file reviews.",
            max_output: 1600,
            strict: true
        }) -> {
            summary
            blockers: list[string]
            risks: list[string]
            quick_wins: list[string]
        }
    }
}
```

## Example: chunk summarization

```agentscript
main agent Summarizer {
    model Main
    role "Summarizer"

    main func(input {
        chunks: list[string]
    }) {
        summaries = parallel for chunk in input.chunks max 30 {
            use chunk max 4k as chunk

            generate({
                input: "Summarize this chunk.",
                max_output: 300,
                strict: true
            }) -> {
                summary
                key_points: list[string]
            }
        }

        use summaries.summary max 8k as chunk_summaries

        generate({
            input: "Combine the chunk summaries into a final summary.",
            max_output: 1200,
            strict: true
        }) -> {
            summary
            key_points: list[string]
        }
    }
}
```

## Semantic checker rules

The semantic checker rejects:

### 1. Body without final value

```agentscript
results = parallel for step in steps max 10 {
    use step as current_step
}
```

Diagnostic:

```text
parallel for body must end with a value expression
```

### 2. Assignment to outer variable

```agentscript
count = 0

results = parallel for step in steps max 10 {
    count = step
    Executor(step)
}
```

Diagnostic:

```text
parallel for body cannot assign to outer variable 'count'
```

### 3. Mutation of outer variable

```agentscript
scratch = []

results = parallel for step in steps max 10 {
    scratch.add(step)
    Executor(step)
}
```

Diagnostic:

```text
parallel for body cannot mutate outer variable 'scratch'
```

### 4. Effectful tool call

```agentscript
results = parallel for item in items max 10 {
    File.write({
        path: item.path,
        content: item.content
    })
}
```

Diagnostic:

```text
effectful tool 'File.write' is not allowed inside parallel for
```

### 5. Non-list input

```agentscript
results = parallel for step in plan max 10 {
    Executor(step)
}
```

Diagnostic:

```text
parallel for source must be a list
```

## Non-goals

`parallel for` is not intended to support:

```text
general async programming
background jobs
task handles
manual scheduling
shared mutable state
actor systems
message passing
parallel reductions
parallel loops with dependencies
cancellation semantics in the language
```

Sequential dependency should remain sequential:

```agentscript
stop = false

for step in plan.steps max 10 {
    result = Executor(step)
    results.add(result)

    if should_stop(results) {
        stop = true
    }
}
```

Independent work should use `parallel for`:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

## Design checklist

Before changing `parallel for`, verify:

```text
Does it still avoid async/await?
Does it still return results in input order?
Does each iteration have an independent child scope?
Can iterations mutate outer state?
Does context declared inside an iteration leak?
Does it preserve no implicit prompt capture?
Does trace remain deterministic?
Is concurrency bounded by runtime policy?
Are effectful tools handled safely?
Does it remain focused on independent agent/generate work?
```

## Final design summary

```text
parallel for is AgentScript's only structured parallelism primitive.

It runs independent iterations over a list concurrently, collects results as a list
in input order, prevents shared mutable state, and preserves deterministic trace.

It exists to solve the real bottleneck of multi-agent and multi-generate workflows
without turning AgentScript into a general asynchronous programming language.
```

Canonical example:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor({
        goal: input.goal,
        step: step
    })
}
```
