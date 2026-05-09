# `generate`

本文档定义 AgentScript 中 `generate` 的语义：generation site、prompt 层次、agent identity、selected context、输出契约、生成配置、重试、校验、debug output 和 trace output。

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

## 推荐语法

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
    category string
    confidence number
}
```

`->` 后面的输出 shape 是可选的：

```agentscript
generate({ input: "Draft a response." })
```

没有声明 shape 时，runtime 不应注入 schema，也不应要求 provider 返回结构化 JSON。自由形式的 `generate` 是允许的，但不推荐用于 agent workflow；优先声明明确的输出 shape，便于 retry、validation、trace 和下游 agent 调用保持可审计。

## 配置字段

| 字段 | 必需 | 类型 | 语义 |
|---|---:|---|---|
| `input` | 是 | `string` | 本次 `generate` 的任务指令。 |
| `max_output` | 否 | `number` / budget literal | 请求的输出生成预算。 |
| `attempts` | 否 | `number` | JSON parse 失败或 shape validation 失败时的重试次数。 |
| `temperature` | 否 | `number` | 采样温度，传递给支持该参数的 provider。 |
| `think` | 否 | `boolean` / `string` | 请求模型启用 reasoning / thinking 模式。 |
| `strict` | 否 | `boolean` | 控制 shape validation 是否严格。 |
| `debug` | 否 | `boolean` | 是否输出 prompt / trace 调试信息。 |

推荐默认值：

```text
max_output: provider/runtime default
attempts: 1
temperature: provider/model default
think: false
strict: false
debug: false
```

这些字段分为三类：

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
use input.question as "user question"
use scratch.summary max 2k as observations
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

## `max_output`

`max_output` 表示本次模型生成的输出预算。

```agentscript
generate({
    input: "Answer briefly",
    max_output: 300
}) -> {
    answer string
}
```

语义：

```text
max_output = provider-side generation budget requested by AgentScript
```

它和 `use` 的输入上下文预算分开：

```agentscript
use docs.summary max 4k

generate({
    input: "Answer from the selected docs",
    max_output: 800
}) -> {
    answer string
}
```

区别：

```text
use ... max 4k       = 输入上下文预算
max_output: 800    = 输出生成预算
```

## `attempts`

`attempts` 控制 runtime 获取有效结构化结果的尝试次数。`attempts` 是最大总尝试次数，包含第一次尝试。

```agentscript
generate({
    input: "Extract metadata",
    max_output: 500,
    attempts: 3
}) -> {
    title string
    tags list[string]
}
```

触发重试的情况：

```text
JSON parse failed
shape validation failed
required field missing
type mismatch
strict mode violation
```

不应重试的情况：

```text
provider auth error
network error
model not found
quota exceeded
timeout，是否重试可由 runtime policy 决定
```

默认值：

```text
attempts: 1
```

## `temperature`

`temperature` 是采样温度。

```agentscript
generate({
    input: "Brainstorm alternatives",
    max_output: 1000,
    temperature: 0.7
}) -> {
    ideas list[string]
}
```

语义：

```text
如果选中的 provider/model 支持，则作为 sampling temperature 透传。
如果不支持，adapter 可以按照 capability policy 选择 ignore、warn 或 fail。
```

## `think`

`think` 是模型 reasoning / thinking 模式请求。

推荐支持：

```agentscript
think: false,
think: true,
think: "auto",
think: "low",
think: "medium",
think: "high"
```

语义：

```text
false     不请求 thinking/reasoning 模式
true      请求 provider 默认 thinking/reasoning 模式
"auto"    由 provider/model 自行决定
"low"     请求低强度 reasoning
"medium"  请求中等强度 reasoning
"high"    请求高强度 reasoning
```

示例：

```agentscript
generate({
    input: "Analyze the tradeoffs",
    max_output: 1200,
    think: "high"
}) -> {
    decision string
    tradeoffs list[string]
    risks list[string]
}
```

`think` 是 provider/model capability hint，不是所有模型都保证支持。如果不支持，adapter 可以按照 capability policy 选择 ignore、warn 或 fail。

## Provider hint 的 capability policy

`temperature` 和 `think` 都是 provider/model capability hint。不支持的 provider hint 默认在 debug mode 下 warn，否则 ignore。

Adapter 可以按照 runtime capability policy 对不支持的 hint 选择 ignore、warn 或 fail，但文档中的默认语义统一为：

```text
不支持的 provider hint 默认在 debug mode 下 warn，否则 ignore
```

## `strict`

`strict` 控制输出 shape validation。

```agentscript
generate({
    input: "Classify the issue",
    max_output: 300,
    strict: true
}) -> {
    category string
    confidence number
}
```

默认：

```text
strict: false
```

### `strict: false`

允许有限 coercion：

```text
"true"  -> true
"false" -> false
"42"    -> 42
"3.14"  -> 3.14
```

但仍然要求：

```text
输出可解析
必需字段存在
无法安全转换的类型失败
```

### `strict: true`

严格验证：

```text
禁止 coercion
必需字段必须存在
字段类型必须精确匹配
extra fields rejected
shape mismatch triggers retry if attempts > 1
```

一句话：

```text
strict 是 AgentScript runtime 对输出契约的控制。
```

## `debug`

`debug` 控制本次 `generate` 的调试输出。

```agentscript
generate({
    input: "Answer the question",
    max_output: 800,
    debug: true
}) -> {
    answer string
}
```

建议输出：

```text
resolved agent identity
generate input
selected context entries
context labels
budgets
rendered prompt/messages
output shape
raw model output
validation result
```

`debug` 只影响调试输出，不改变 prompt 语义。

## Trace 要求

`generate` trace 应解释实际 prompt 输入、配置、校验和结果：

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

Trace 要能回答：

- 哪个 agent identity 生成了该输出？
- 使用了什么 instruction？
- 哪些 selected context 可见？
- 哪些 context item 被裁剪？
- 请求了哪些 provider hint 和 runtime behavior？
- 请求了什么 shape？
- 尝试了几次？
- 使用了什么 validation mode？
- 返回了什么值？

## Final expression return

`generate` 表达式可以作为函数体最后一个顶层表达式。在这种情况下，函数会隐式返回生成值。

```agentscript
func answer(question) {
    use question as "user question"

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
- `max_output` 是否仍是输出生成预算，而不是 context item budget？
- `strict` 是否仍是 runtime validation behavior，而不是 provider 配置？
- `think` 是否仍是 provider/model capability hint，而不是保证可用的 reasoning access？
- trace 是否解释了实际 prompt、配置、校验和结果？
