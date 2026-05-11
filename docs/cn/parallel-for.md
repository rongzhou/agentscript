# `parallel for`

本文档定义 `parallel for`：AgentScript 用于在有界列表上执行独立 multi-agent、tool 或 `generate` 工作的结构化并行原语。

Context 选择见 [`use ... as ...`](./use-as.md)。Generation site 和输出契约见 [`generate`](./generate.md)。

## 目的

AgentScript 不暴露通用 async 系统。

它不定义：

```text
async
await
Promise
Task
spawn
join
background jobs
```

相反，AgentScript 只提供一个结构化并行原语：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

它的目的很窄：

```text
并发运行相互独立的 iteration，
按输入顺序收集结果，
保留确定性的 trace，
并避免共享可变状态。
```

它面向真实 AgentScript 瓶颈，例如：

```text
multi-agent execution
multi-file review
multi-chunk summarization
multi-step plan execution
multi-result analysis
```

## 推荐语法

```agentscript
results = parallel for item in items max 10 {
    expression
}
```

示例：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor({
        goal: input.goal,
        step: step
    })
}
```

循环体必须以一个 value expression 结束。每个 iteration 的结果会被收集到一个 list 中。

结果顺序与输入顺序一致，而不是完成顺序。

## 基本语义

给定：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

AgentScript 按如下方式求值：

```text
1. 对 plan.steps 求值一次。
2. 最多取 10 个 item。
3. 启动相互独立的 iteration。
4. 在 runtime concurrency limit 约束下并发运行 iteration。
5. 每个 iteration 在独立 child scope 中求值 body。
6. 每个 iteration 返回其 final expression 的值。
7. 将所有 iteration 结果收集为 list。
8. 返回 list 时保留输入顺序。
```

但 AgentScript 不向语言用户暴露 promise 或 async/await。

## 与普通 `for` 的比较

顺序 `for`：

```agentscript
results = []

for step in plan.steps max 10 {
    result = Executor(step)
    results.add(result)
}
```

语义：

```text
iteration 一个接一个运行
后续 iteration 可以依赖先前状态
body 可以更新局部状态
```

Parallel `for`：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

语义：

```text
iteration 相互独立
iteration 可以并发运行
iteration 不共享可变局部状态
结果自动收集
```

差异不只是性能。`parallel for` 是对 iteration 相互独立的声明。

## 结果值

`parallel for` 是表达式。它返回一个 list：

```agentscript
results = parallel for file in files max 20 {
    ReviewFile(file)
}
```

如果 `files` 包含：

```json
[
  "a.ts",
  "b.ts",
  "c.ts"
]
```

那么 `results` 对应：

```json
[
  result_for_a,
  result_for_b,
  result_for_c
]
```

list 顺序始终跟随输入顺序。即使 `c.ts` 最先完成，它的结果仍位于 index `2`。

## Final expression return

`parallel for` 的 body 必须产生一个值。

合法：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

合法：

```agentscript
results = parallel for step in plan.steps max 10 {
    result = Executor(step)

    {
        step: step,
        result: result
    }
}
```

非法：

```agentscript
results = parallel for step in plan.steps max 10 {
    use step as current_step
}
```

原因：

```text
parallel for body must end with a value expression
```

非法：

```agentscript
results = parallel for step in plan.steps max 10 {
    log = Executor(step)
    // no final expression
}
```

Semantic checker 应拒绝无法产生 iteration value 的 `parallel for` body。

## Scope 规则

每个 iteration 在独立 child scope 中运行。

示例：

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

规则：

```text
外层可见 context 可以被继承
每个 iteration 有自己的局部变量
一个 iteration 内声明的 context 只属于该 iteration
一个 iteration 内声明的 context 不会泄漏到其他 iteration
一个 iteration 内声明的 context 不会泄漏到 parallel for 外部
```

在该示例中：

```text
goal 对所有 iteration 可见
current_step 在每个 iteration 中不同
current_step 不会泄漏到 iteration 外部
```

## Function 和 Agent 边界

现有 AgentScript 边界规则仍然适用。

如果 body 调用 Agent：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor({
        goal: input.goal,
        step: step
    })
}
```

那么每次 `Executor(...)` 调用都会创建一个 agent boundary。

被调用 Agent 不会自动继承 caller 已选择的 context。它只能看到自己的输入值，以及被调用 Agent 内部选择的 context。

这保持 multi-agent auditability。

## 无共享可变状态

`parallel for` iteration 可以读取外层变量，但不能写入或 mutate 外层变量。

非法：

```agentscript
count = 0

results = parallel for step in plan.steps max 10 {
    count = step
    Executor(step)
}
```

非法：

```agentscript
scratch = []

results = parallel for step in plan.steps max 10 {
    result = Executor(step)
    scratch.add(result)
    result
}
```

原因：

```text
parallel for iterations must not mutate outer local state
```

正确：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}

scratch.add(results.summary)
```

设计规则是：

```text
parallel work returns values;
aggregation happens after parallel work completes.
```

这让执行保持确定性和可追踪。

## Tool side effects

AgentScript 对 `parallel for` 内的副作用保持保守。

Read-only tools 可以在 `parallel for` 内使用：

```agentscript
read_results = parallel for file in files max 20 {
    read = File.read({ path: file.path })
    read.content
}
```

Effectful tools 会被拒绝，除非 runtime 明确将其标记为 concurrency-safe：

```agentscript
results = parallel for file in files max 20 {
    File.write({
        path: file.output,
        content: "..."
    })
}
```

推荐错误：

```text
Effectful operation File.write is not allowed inside parallel for.
Move the effect outside the parallel block or mark the tool as concurrency-safe.
```

Effectful operation 示例：

```text
File.write
File.patch
File.delete
Memory.add
HTTP POST/PUT/PATCH/DELETE
external command with side effects
```

通常安全的操作示例：

```text
File.read
File.list
Grep.run
HTTP GET
pure host tools
agent calls
generate calls
```

## `max` 语义

在：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

`max 10` 限制消耗多少个输入 item。

它不是并发度。

```text
max 10 = process at most 10 items
```

并发度由 runtime configuration 控制。

示例：

```bash
agentscript app.as --concurrency 4
```

推荐默认值：

```text
concurrency: 4
```

Runtime 也可以应用 provider-specific rate limit。

## Concurrency limit

`parallel for` 不会启动无限数量的 LLM 调用。

Runtime 通过 concurrency limiter 执行 iteration。

推荐行为：

```text
default concurrency = 4
CLI override: --concurrency N
SDK option: concurrency: N
provider adapters may apply stricter limits
```

示例：

```bash
agentscript workflows/review.as \
  --input '{"path":"src"}' \
  --concurrency 3 \
  --trace
```

如果有 10 个 item，concurrency 为 3：

```text
最多 3 个 iteration 同时运行
结果仍按输入顺序返回
trace 仍按输入顺序显示
```

## 错误语义

`parallel for` 使用 wait-all 语义。

这意味着：

```text
启动所有已调度 iteration
等待所有 iteration settle
如果全部成功，返回 value list
如果任意失败，整个 parallel for 失败
保留每个 iteration 的 trace
```

它不会 fail fast。

原因：

```text
LLM 调用成本高
debugging 需要完整 branch 信息
trace 展示完整执行状态
```

失败示例：

```text
parallel for failed:
- [0] ok, 1820ms
- [1] failed, provider timeout, 5000ms
- [2] ok, 2310ms
```

失败表达式包含每个失败 iteration 的 diagnostics。

## Trace 要求

Trace 是该功能的一部分，不是事后补充。

`parallel for` trace 记录：

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

Pretty trace：

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

显示顺序保持确定性：

```text
trace output 按 input index 分组，而不是按完成顺序分组
```

紧凑确定性视图：

```text
ParallelFor #1 completed
  [0] ok, 2310ms
  [1] ok, 1840ms
  [2] ok, 2680ms
```

## Prompt context 交互

`parallel for` 不会自动把结果加入 prompt context。

示例：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

结果只是普通数据。

只有被显式选择时，它们才会进入后续 prompt：

```agentscript
use results.summary max 6k as execution_results

generate({
    input: "Summarize execution results",
    max_output: 1200,
    strict: true
}) -> {
    summary
    failures list[string]
    next_action
}
```

这保留 AgentScript 核心不变量：

```text
no implicit prompt capture
```

## 示例：plan execution

```agentscript
main agent Controller {
    model Main
    role "Controller"
    description "Plan work, execute independent steps, and summarize the outcome."

    main func(input {
        goal string
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
            completed list[string]
            failed list[string]
            next_action
        }
    }
}
```

它表达常见模式：

```text
plan -> parallel execution -> explicit context selection -> final synthesis
```

## 示例：multi-file review

```agentscript
main agent RepoReviewer {
    model Main
    role "Repository Reviewer"

    main func(input {
        files list[json]
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
            blockers list[string]
            risks list[string]
            quick_wins list[string]
        }
    }
}
```

## 示例：chunk summarization

```agentscript
main agent Summarizer {
    model Main
    role "Summarizer"

    main func(input {
        chunks list[string]
    }) {
        summaries = parallel for chunk in input.chunks max 30 {
            use chunk max 4k as chunk

            generate({
                input: "Summarize this chunk.",
                max_output: 300,
                strict: true
            }) -> {
                summary
                key_points list[string]
            }
        }

        use summaries.summary max 8k as chunk_summaries

        generate({
            input: "Combine the chunk summaries into a final summary.",
            max_output: 1200,
            strict: true
        }) -> {
            summary
            key_points list[string]
        }
    }
}
```

## Semantic checker 规则

Semantic checker 会拒绝：

### 1. Body 没有 final value

```agentscript
results = parallel for step in steps max 10 {
    use step as current_step
}
```

Diagnostic：

```text
parallel for body must end with a value expression
```

### 2. 给外层变量赋值

```agentscript
count = 0

results = parallel for step in steps max 10 {
    count = step
    Executor(step)
}
```

Diagnostic：

```text
parallel for body cannot assign to outer variable 'count'
```

### 3. Mutate 外层变量

```agentscript
scratch = []

results = parallel for step in steps max 10 {
    scratch.add(step)
    Executor(step)
}
```

Diagnostic：

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

Diagnostic：

```text
effectful tool 'File.write' is not allowed inside parallel for
```

### 5. Non-list input

```agentscript
results = parallel for step in plan max 10 {
    Executor(step)
}
```

Diagnostic：

```text
parallel for source must be a list
```

## 非目标

`parallel for` 不用于支持：

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

有顺序依赖的逻辑应保持顺序：

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

独立工作应使用 `parallel for`：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

## 设计检查清单

修改 `parallel for` 前，应检查：

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

## 最终设计摘要

```text
parallel for is AgentScript's only structured parallelism primitive.

It runs independent iterations over a list concurrently, collects results as a list
in input order, prevents shared mutable state, and preserves deterministic trace.

It exists to solve the real bottleneck of multi-agent and multi-generate workflows
without turning AgentScript into a general asynchronous programming language.
```

Canonical example：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor({
        goal: input.goal,
        step: step
    })
}
```
