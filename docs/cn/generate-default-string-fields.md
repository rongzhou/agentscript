# `generate` 输出 Shape 中的默认 String 字段

本文档定义 AgentScript 中 `generate` 输出 shape 的默认 string 简写规则。

`generate` 的整体语义见 [`generate`](./generate.md)。紧凑语言参考见 [AgentScript Language](./language.md)。

## 目的

LLM structured output 经常包含大量文本字段。

当前显式语法：

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

这种写法清晰，但当大多数字段都是 string 时会显得重复。

默认 string 简写允许 `generate` 输出 shape 中的 string 字段省略 `string` 标注：

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

该简写等价于上面的显式形式。

## 设计原则

```text
Generated text is string by default.
External input is explicit by default.
```

`generate` 输出 shape 面向 LLM ergonomics 优化。外部输入契约保持显式，因为它描述的是从程序外部进入的数据。

## 适用范围

该规则只适用于 `generate` 表达式的输出 shape。

合法：

```agentscript
generate({ input: "Answer" }) -> {
    answer
    rationale
}
```

等价于：

```agentscript
generate({ input: "Answer" }) -> {
    answer string
    rationale string
}
```

该规则不适用于 input shape、function parameter shape、imported data schema，或未来的通用类型声明。

非法：

```agentscript
main func(input {
    path
}) {
}
```

必须写成：

```agentscript
main func(input {
    path string
}) {
}
```

## 语法

在 `generate(...) -> { ... }` 输出 shape 中，字段可以写成显式形式或简写形式：

```agentscript
field_name type
field_name
```

简写字段会被规范化为：

```agentscript
field_name string
```

示例：

```agentscript
generate({ input: "Classify the issue" }) -> {
    category
    confidence number
    urgent boolean
    reasons list[string]
}
```

解析后的输出契约：

```text
category string
confidence number
urgent boolean
reasons list[string]
```

## 字段终止边界

只有当字段名后面跟着字段边界时，缺失类型才会被识别为默认 string。

字段边界包括：

```text
换行
逗号
右大括号
```

合法：

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
}
```

如果 parser 支持 comma-separated shape fields，下面也合法：

```agentscript
generate({ input: "Summarize" }) -> {
    title,
    summary,
}
```

如果字段名后同一行出现另一个 identifier，则它会被视为显式类型，并且必须是支持的 shape type。

非法：

```agentscript
generate({ input: "Classify" }) -> {
    confidence nubmer
}
```

诊断：

```text
Unsupported shape type 'nubmer'
```

Parser 不能把它解释成：

```text
confidence string
nubmer string
```

## 规范化

解析和语义分析之后，每个 shape field 都有显式 resolved type。

源码：

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
    key_points list[string]
}
```

Resolved shape：

```text
title string
summary string
key_points list[string]
```

Runtime validation、provider schema、retry 和 trace output 都基于 resolved shape 工作。

## Trace 和 Debug 输出

Trace 和 debug output 应显示 resolved output contract，而不是含糊的源码级简写。

源码：

```agentscript
generate({ input: "Summarize" }) -> {
    title
    summary
}
```

Trace display：

```text
Output shape:
  title string
  summary string
```

这保证生成输出契约保持显式且可审计。

## 非目标

该规则不增加：

```text
global default string types
implicit input types
optional fields
default values
schema inference
type aliases
computed field names
```

它只缩短 `generate` 输出 shape 中常见的 string 字段。

## 推荐风格

普通生成文本字段使用简写：

```agentscript
generate({ input: "Summarize the document" }) -> {
    title
    summary
    key_points list[string]
    action_items list[string]
}
```

非 string 字段保持显式类型：

```agentscript
generate({ input: "Classify the issue" }) -> {
    category
    confidence number
    urgent boolean
    reasons list[string]
}
```

Input shape 保持显式：

```agentscript
main func(input {
    path string
    max_items number
}) {
}
```

## 一句话定义

```text
In generate output shapes, an untyped field defaults to string; everywhere else, fields require explicit types.
```

## 设计检查清单

修改 output shape 语法前，应检查：

- 简写是否只适用于 `generate` 输出 shape？
- 外部输入契约是否仍然要求显式类型？
- 同一行类型名拼写错误的诊断是否保留？
- Runtime validation 是否基于 resolved explicit types？
- Trace 是否显示 resolved output contract？
- 该规则是否避免引入 schema inference、optional fields 和 default values？
