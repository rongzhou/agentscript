# `generate`

本文档定义 AgentScript 中 `generate` 的语义：generation site、prompt 层次、agent identity、selected context、输出契约、预算、重试和 trace。

Context 选择和 label 见 [`use ... as ...`](./use-as.md)。整体设计总纲见 [Context Engineering](./context-engineering.md)。

## 目的

`generate` 是 AgentScript 中唯一的 LLM 调用点。

```agentscript
generate({ input: "Answer using the selected context." }) -> {
    ok boolean
    answer string
}
```

普通代码可以计算值、调用工具、调用 Agent 和组织状态。只有 `generate` 会请求当前模型生成新输出。

## 语法

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

`->` 后面的输出 shape 是可选的：

```agentscript
generate({ input: "Draft a response." })
```

没有声明 shape 时，runtime 不应注入 schema，也不应要求 provider 返回结构化 JSON。

## Prompt 构造

一次 `generate` 的 prompt 有四个概念层。

### Agent identity

Agent identity 来自当前 Agent 配置：

```agentscript
role "Senior Researcher"
description "Answer questions with search and structured reasoning."
```

它会作为 identity 渲染进 provider system prompt：

```text
You are Senior Researcher.
Answer questions with search and structured reasoning.
```

Agent `role` 是 AgentScript 的身份概念，不等同于 `system`、`user`、`assistant` 等 provider message role。

### Selected context

Selected context 来自可见的 `use` 声明：

```agentscript
use input.question as user question
use scratch.summary < 2k as observations
```

渲染出的 prompt section 可以是：

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

Context label 用于组织 prompt section，不会创建 provider message。

### Instruction

Instruction 来自 `generate(...)` 的 `input` 字段：

```agentscript
generate({ input: "Answer using only the selected context." }) -> {
    answer string
}
```

Instruction 是本次 LLM 调用的局部任务，区别于长期 context。

### Output contract

Output contract 来自 `->` 后可选的 shape：

```agentscript
generate({ input: "Answer" }) -> {
    ok boolean
    answer string
    citations list[string]
}
```

Runtime 会在可能时请求 provider 返回结构化输出，并校验返回值满足该 shape。

## Budgets

`generate({ limit: n })` 是 generation budget。它限制输出规模，或映射到底层 provider token limit。

```agentscript
generate({
    input: "Summarize"
    limit: 500
}) -> {
    text string
}
```

这不同于 context item budget：

```agentscript
use docs.summary < 4k as evidence
```

前者控制生成输出，后者控制 selected context 渲染进 prompt 的大小。

## Attempts 和 repair

`attempts` 控制 runtime 为了得到满足 shape 的结果最多尝试多少次。

```agentscript
generate({
    input: "Extract fields"
    attempts: 3
}) -> {
    title string
    tags list[string]
}
```

如果 provider 返回不是合法 JSON 或不满足 shape，runtime 可以带 repair feedback 重试。基础设施错误不应被当作可修复的模型输出。

## Debug output

`debug: true` 允许 runtime 打印或暴露最终 prompt 供检查。

```agentscript
generate({
    input: "Answer"
    debug: true
}) -> {
    answer string
}
```

Debug output 面向开发者，不属于 prompt context。

## Trace 要求

`generate` trace 应解释实际 prompt 输入和结果：

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

Trace 要能回答：

- 哪个 agent identity 生成了该输出？
- 使用了什么 instruction？
- 哪些 selected context 可见？
- 哪些 context item 被裁剪？
- 请求了什么 shape？
- 尝试了几次？
- 返回了什么值？

## Final expression return

`generate` 表达式可以作为函数体最后一个顶层表达式。在这种情况下，函数会隐式返回生成值。

```agentscript
func answer(question) {
    use question as user question

    generate({ input: "Answer" }) -> {
        answer string
    }
}
```

当没有更早执行显式 `return` 时，这等价于显式返回 generate 结果。

## 设计检查清单

修改 `generate` 前，应检查：

- 它是否仍是唯一 LLM 调用点？
- 它是否只使用可见的 `use` context source？
- 它是否仍区分 agent identity、selected context、instruction 和 output contract？
- `role` 是否仍是 agent identity，而不是 provider role 控制？
- `limit` 是否仍是 generation budget，而不是 context item budget？
- trace 是否解释了实际 prompt 和结果？
