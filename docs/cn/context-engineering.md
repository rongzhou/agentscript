# AgentScript Context Engineering

本文档说明 AgentScript 中 `use`、作用域和 `generate` 的核心设计含义。这个概念不属于某个特定版本，而是 AgentScript 区别于普通编程语言的基础语义。

AgentScript 表面上有变量、函数、循环和 Agent 调用，但它的主要目标不是成为通用编程语言，而是提供一种可审计、可组合、显式的 prompt context engineering DSL。

后续开发涉及 `use`、scope、context builder、trace 或 prompt 结构时，应优先参考本文档。若实现细节与本文不一致，应先判断是实现尚未跟上设计，还是本文需要更新。

## 核心定位

AgentScript 的控制流服务于 prompt context 构建。

普通语句负责组织数据、调用工具、调用 Agent 和更新中间状态。LLM 调用只能通过 `generate(...) { return ... }` 发生，而 `generate` 能看到的上下文必须由 `use` 显式声明。

AgentScript 的核心对象是：

- `Data`：普通变量、JSON、list、file import、tool observation 和 Agent 返回值。
- `Context Source`：由 `use expr < budget` 声明的 prompt context 来源。
- `Generation Site`：由 `generate({ input, limit, attempts, debug }) { return shape }` 声明的一次 LLM 调用。
- `Boundary`：由 Agent、function 和 block scope 形成的 context 可见性边界。

## `use` 的语义

`use` 不是普通编程语言中的变量读取，也不是把变量导入某个命名空间。`use` 的含义是：

> 在当前作用域声明一个 prompt context source，使后续在该作用域内可见的 `generate` 可以把该 source 的值放入 prompt context。

例如：

```agentscript
func answer(question, scratch) {
    use question
    use scratch.summary < 2k

    return generate({
        input: "Answer the question using collected facts"
        limit: 800
    }) {
        return {
            ok boolean
            text string
            error string
        }
    }
}
```

这里 `question` 和 `scratch.summary` 是本次 `generate` 的显式 context source。没有被 `use` 的局部变量不应自动进入 prompt。

## `use` 应是延迟求值的 context source

目标语义是：

> `use expr < budget` 声明的是 `expr` 这个 context source，而不是立即复制 `expr` 的当前值。真正构建 prompt 时，应在 `generate` 执行点解析该 source 的当前值。

因此，下面的程序应让 `generate` 看到更新后的 `scratch.summary`：

```agentscript
main func(input) {
    scratch = []
    use scratch.summary < 2k

    scratch.add({ fact: "A" })
    scratch.add({ fact: "B" })

    return generate({ input: "Answer from scratch" }) {
        return {
            text string
        }
    }
}
```

设计理由：

- `use` 表达的是 context contract，而不是一次普通赋值。
- Agent 常见模式会持续更新 scratch、plan、observations。
- 如果 `use` 是快照，用户必须在每个 `generate` 前重复声明，容易造成陈旧 context。
- 延迟求值更符合 context engineering 中“声明可见源，在调用点构建 prompt”的直觉。

实现上可以把 `use` 存为 `expr + declaring scope + budget`，在 `generate` 构建 context 时再求值。

## `use` 与 prompt 暴露边界

默认情况下，LLM 不应看到当前函数内的全部变量。

以下内容只有被显式 `use` 后才可进入 prompt context：

- 用户输入。
- 中间结果。
- scratch 或 memory-like 数据。
- 工具 observation。
- imported file 的内容。
- 其他 Agent 的返回值。

以下 runtime capability 不应作为 prompt context：

- imported tool。
- imported llm/model。
- imported agent binding。
- function binding。
- provider URI、workspace path 等执行配置。

例如，下面应被语义分析禁止：

```agentscript
use Search
use Qwen
use Worker
use helper
```

这条规则的目的不是类型洁癖，而是防止把执行能力或 runtime 配置误当作数据暴露给 LLM。

## Scope 是 context boundary

AgentScript 中的作用域不仅是变量可见性规则，也是 prompt context 可见性规则。

### Function boundary

函数调用应创建独立 context boundary。

```agentscript
func caller(input) {
    use input.goal
    return helper(input)
}

func helper(input) {
    use input.detail
    return generate({ input: "Work on detail" }) {
        return {
            ok boolean
        }
    }
}
```

`helper` 内部的 `generate` 不应自动继承 `caller` 的 `use input.goal`，除非该数据作为参数传入并在 `helper` 内显式 `use`。

推荐原则：

- function 的 prompt context 由 function 自己声明。
- function 返回值不携带 prompt context。
- caller 的 `use` 不应隐式污染 callee。

### Agent boundary

Agent 调用是更强的 context boundary。

```agentscript
result = Worker({
    goal: input.goal
    previous: results.summary
})
```

`Worker` 不应自动看到 Controller 的 context。Controller 必须通过参数显式传入必要数据，Worker 再用自己的 `use` 声明 prompt context。

这保证：

- 每个 Agent 的 prompt contract 独立可审计。
- 多 Agent 组合不会发生隐式 context 泄露。
- 子 Agent 只看到调用者明确传入的数据。

### Block boundary

`if`、`repeat`、`loop`、`for` 等 block 可以创建子作用域。子作用域内声明的 `use` 只应影响该子作用域内可见的 `generate`。

```agentscript
if condition {
    temp = compute(input)
    use temp
    result = generate({ input: "Use temp" }) {
        return {
            ok boolean
        }
    }
}
```

`temp` 和 `use temp` 不应泄漏到外层作用域。

### Parent context visibility

如果一个 block 内的 `generate` 处在某个父作用域之下，它可以看到父作用域声明的 context source。可见顺序应从外到内稳定排列，便于 trace 和 prompt 审计。

## Context 构建模型

一次 `generate` 的 prompt 应由四层组成。

### System

System 层描述 Agent identity 和稳定行为约束，例如：

- Agent name。
- `role`。
- `description`。

System 层不应包含 provider URI、workspace path、tool implementation detail 或其它执行配置。

### Context

Context 层来自当前 `generate` 可见的 `use` 声明。

每个 context item 应包含：

- source expression，例如 `scratch.summary`。
- resolved value。
- rendered text。
- budget。
- clipping status。

推荐 prompt 形态：

```text
Context:
[0] question:
What is AgentScript?

[1] scratch.summary:
[
  { "fact": "..." }
]
```

source label 有助于模型理解 context，也有助于人类审计。

### Instruction

Instruction 层来自 `generate(...)` 参数对象中的 `input` 字段。

```agentscript
generate({ input: "Answer the question using only collected facts" }) {
    return {
        ok boolean
        text string
    }
}
```

Instruction 是本次 LLM 调用的局部任务，不应混入长期 context。

`limit`、`attempts` 和 `debug` 是 `generate` 的局部配置，不属于 prompt context。只有当上一次输出不是 JSON 或不满足 shape 时，runtime 才会在下一次尝试中把错误反馈附加到 instruction。

### Output contract

Output contract 来自 `return shape`。

```agentscript
return {
    ok boolean
    text string
    error string
}
```

LLM provider 和 runtime 应尽可能强制输出满足该 shape。

## Budget 语义

`use expr < budget` 是 context item budget。

```agentscript
use scratch.summary < 2k
```

它限制的是该 context source 渲染进 prompt 的大小，不是整个 LLM 调用的输出预算。

`generate({ limit: budget }) { ... }` 是 generation budget。

```agentscript
return generate({
    input: "Summarize"
    limit: 500
}) {
    return {
        text string
    }
}
```

它限制的是本次生成的输出规模或 provider token limit。

两者语义不同，不应混用。

可以先用字符数近似 context budget，但文档和 trace 必须明确实际裁剪策略。若未来切换到 token budget，不应改变 `use` 的抽象含义。

## Clipping 策略

Context clipping 不应只做简单字符串截断，因为这会破坏 JSON/list 结构。

推荐策略：

- string 可以按字符截断。
- list 应优先保留完整 item。
- object 应优先保留完整字段。
- 超限时 trace 应记录原始大小、裁剪后大小和裁剪策略。

如果暂时使用简单字符串截断，必须在 trace 中标记 `clipped: true`，并在文档中说明这是早期实现策略。

## Trace 要求

Trace 是 context engineering DSL 的核心调试接口。

`use` trace 应记录声明信息：

```json
{
  "kind": "use",
  "data": {
    "source": "scratch.summary",
    "budget": { "amount": 2, "unit": "k" }
  }
}
```

`generate` trace 应记录实际构建出的 context：

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

这使开发者可以回答：

- 本次 LLM 调用到底看到了什么？
- 哪些 context source 被声明但没有进入当前 generate？
- 哪些 context 被裁剪？
- context 是从哪个表达式解析出来的？
- caller 和 callee 的 context 是否发生了意外污染？

## `summary` view 的含义

`scratch.summary` 是 AgentScript 中常见的 context engineering 写法。

```agentscript
scratch = []
scratch.add(observation)
use scratch.summary < 2k
```

它表达的是“把 scratch 的 prompt-friendly view 放入 context”。如果实现中 `summary` 只是 JSON-safe list view，而不是真正的 LLM 摘要，应在文档和 trace 中明确。

推荐长期方向：

- `summary` 表示适合 prompt 的紧凑视图。
- `summary` 不应暴露 runtime resource binding。
- `summary` 可以结合 clipping 策略保留最有用的完整 item。

## 实现约束

为了避免把 AgentScript 误实现成普通编程语言，后续改动应遵守以下约束：

- `generate` 不自动捕获局部变量。
- `use` 是 context declaration，不是普通赋值。
- `use` 的值应在 `generate` 构建 prompt 时解析。
- function 和 Agent 调用应形成 context boundary。
- runtime capability 不应进入 prompt context。
- prompt 中应区分 system、context、instruction 和 output contract。
- trace 必须能解释每次 `generate` 的实际 context。

## 设计检查清单

修改 `use`、scope、context builder、trace 或 LLM provider 前，应检查：

- 这个改动是否让未 `use` 的数据进入了 prompt？
- 这个改动是否让 caller context 隐式污染 callee？
- 这个改动是否把 tool/model/agent/function binding 当作数据暴露给 LLM？
- 这个改动是否保留了 context source 的可审计信息？
- 这个改动是否让 `use` 退化成普通变量快照？
- 这个改动是否混淆了 context budget 和 generation budget？

AgentScript 的核心价值不是多一种控制流语法，而是让 prompt context 的来源、范围、预算和最终形态都变得显式、稳定、可审计。
