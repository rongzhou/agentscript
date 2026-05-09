# `use ... as ...`

本文档定义 AgentScript 中 `use` 如何选择 prompt context，包括 context label、budget、scope 可见性、延迟求值和 trace 要求。

整体模型见 [Context Engineering](./context-engineering.md)。Prompt 构造和输出契约见 [`generate`](./generate.md)。

## 目的

`use` 不是变量读取、赋值或命名空间导入。它声明一个 prompt context source。

```agentscript
use input.question as user question
use scratch.summary max 2k as observations
```

含义是：

```text
让这个 source 对当前作用域及子作用域中后续的 generate 可见
```

没有被 `use` 选择的局部变量不会进入 prompt。

## 语法

```agentscript
use expr
use expr max budget
use expr as label
use expr max budget as label
```

固定顺序是：

```text
选择什么 -> 限制多少 -> 作为何种上下文
```

示例：

```agentscript
use input.question as user question
use docs.summary max 4k as retrieved evidence
use scratch.summary max 2k as observations
```

## Context label

`as` 后面的 label 是字面标签文本，不是表达式，不会求值，也不会读取作用域中的变量。

```agentscript
use docs as evidence
use docs.summary max 4k as retrieved evidence
use input.question as user
```

即使当前作用域中存在名为 `evidence` 的变量，`as evidence` 也只是把 context section 标记为 `evidence`。

Label 影响：

- prompt section label
- trace display
- context organization
- debug 和 audit 可读性

Label 不影响：

- agent identity
- provider message role
- tool 权限
- system/user/assistant 权限

## Provider role 不是 context label

`system`、`user`、`assistant`、`tool` 等 provider role 是 LLM API 的传输协议细节。AgentScript context label 是 prompt 内部组织标签。

为避免和 provider role 混淆，以下 label 保留：

```text
system
assistant
tool
developer
```

`user` 允许作为 context label，因为它常用于表达“这段 context 是用户输入”。它仍然不会创建单独的 provider `user` message。

## 延迟求值

`use expr` 声明的是 source，不是快照。表达式会在可见的 `generate` 构建 prompt 时求值。

```agentscript
main func(input) {
    scratch = []
    use scratch.summary max 2k as observations

    scratch.add({ fact: "A" })
    scratch.add({ fact: "B" })

    generate({ input: "Answer from observations" }) -> {
        text string
    }
}
```

该 `generate` 能看到两个 fact。

这让 `use` 保持为 context contract，而不是一次值复制。

## Scope 可见性

`use` 声明对同一作用域和子作用域中后续的 `generate` 可见。

```agentscript
use input.question as user question

if input.needs_detail {
    use input.detail as detail
    generate({ input: "Answer with detail" }) -> {
        text string
    }
}
```

内部 `generate` 可以看到 `user question` 和 `detail`。`detail` context 不会泄漏到 block 外部。

Function 和 Agent 调用形成独立 context boundary。Callee 不会自动继承 caller 选择的 context。

## 不能 use 什么

Runtime capability 不能进入 prompt context：

- imported tool
- imported LLM/model binding
- imported agent binding
- memory handle
- function binding
- provider URI 和 workspace/runtime 配置

非法示例：

```agentscript
use Search
use Qwen
use Worker
use helper
```

应改为使用这些 capability 返回的数据：

```agentscript
results = Search.search(input.question)
use results max 4k as search results
```

## Budget 语义

`use expr max budget` 是 context item budget，限制该 source 渲染进 prompt 的大小。

```agentscript
use docs.summary max 4k as evidence
```

这不同于 `generate({ max_output: ... })` 的 output generation budget。详见 [`generate`](./generate.md)。

## Prompt 渲染

带 label 的 context item 渲染为 context section：

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

如果没有 label，renderer 可以使用数字 context index，并单独显示 source expression。

## Trace 要求

`use` trace event 记录声明信息：

```json
{
  "kind": "use",
  "data": {
    "source": "scratch.summary",
    "label": "observations",
    "budget": { "amount": 2, "unit": "k" }
  }
}
```

`generate` 的 built context item 记录解析后的值和渲染元数据：

```json
{
  "index": 0,
  "source": "scratch.summary",
  "label": "observations",
  "value": [{ "fact": "A" }],
  "text": "[...]",
  "budget": { "amount": 2, "unit": "k" },
  "clipped": false
}
```

Trace 必须让 source、label、budget、clipping 状态和 resolved value 可审计。

## 设计检查清单

修改 `use` 前，应检查：

- 未使用的数据是否仍然不会进入 prompt？
- source 是否仍在 `generate` 时求值？
- label 是否仍是字面文本，而不是表达式？
- provider role 是否仍与 context label 分离？
- budget 是否仍附着在 context item 上，而不是整个 generation 上？
- function 和 Agent boundary 是否仍能阻止 context 泄漏？
