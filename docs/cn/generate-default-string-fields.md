# Contract Block 中的 Label-only 字段

本文档定义 AgentScript contract block 中的 label-only 简写和 default value 规则。

Contract block 只出现在 AgentScript 期待结构契约的位置：

- `main func` 的第一个 `input` 参数
- `generate(...) ->` 后面的输出 contract

传给 `generate(...)` 的对象不是 contract block。它是 JSON-like options object，其中 `input` 字段承载本次调用的指令。

## 语法

Contract 字段通常写作 `label: value`：

```agentscript
main func(input {
    question: string
    limit: number
}) {
    ...
}
```

当省略 value 时，字段写成 label-only。Label-only 的含义是 `label: default_value`；default value 由 contract 的使用位置定义。

当前只有 `generate(...) -> { ... }` 输出 contract 定义了 default value，并且这个默认值是 `string`：

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
    confidence: number
}
```

它等价于：

```text
title: string
summary: string
confidence: number
```

Label-only 字段不要写悬空冒号。写 `title`，不要写 `title:`。

Input contract 没有定义 default value，所以不能使用 label-only 字段：

```agentscript
main func(input {
    question: string
}) {
    ...
}
```

同理，`use one of` candidate block 也没有定义 default value。每个候选都必须写作 `label: value`。

## 分隔符

Contract 字段使用换行分隔。不允许使用逗号：

```agentscript
generate({ input: "Extract" }) -> {
    title
    tags: list[string]
}
```

单字段 contract 可以保持在一行：

```agentscript
main func(input { path: string }) {
    ...
}
```

Contract block 与 JSON-like object literal 不同。`generate({ ... })` 的 options 使用逗号分隔的 JSON-like object 语法；`-> { ... }` 使用 contract 语法。
