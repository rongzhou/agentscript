# `use ... as ...`

本文档定义 AgentScript 中 `use` 如何选择 prompt context，包括 context label、budget、scope 可见性、延迟求值和 trace 要求。

整体模型见 [Context Engineering](./context-engineering.md)。Prompt 构造和输出契约见 [`generate`](./generate.md)。

## 目的

`use` 不是变量读取、赋值或命名空间导入。它声明一个 prompt context source。

```agentscript
use input.question as "user question"
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

`label` 必须是单个 identifier 或 string literal。包含空格的 label 应写成 string literal。

固定顺序是：

```text
选择什么 -> 限制多少 -> 作为何种上下文
```

示例：

```agentscript
use input.question as "user question"
use docs.summary max 4k as "retrieved evidence"
use scratch.summary max 2k as observations
```

## Context label

`as` 后面的 label 是字面标签文本，不是表达式，不会求值，也不会读取作用域中的变量。

```agentscript
use docs as evidence
use docs.summary max 4k as "retrieved evidence"
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
        text
    }
}
```

该 `generate` 能看到两个 fact。

这让 `use` 保持为 context contract，而不是一次值复制。

## Scope 可见性

AgentScript 的 context 作用域分为 **agent** 和 **function** 两层，每层内部可以有 block 子作用域（`if` / `for` / `loop` / `repeat` / `parallel for`）。`use` 在这三种位置都能出现。

三层可见性概览：

| 层 | 声明位置 | 可见范围 | 主要用途 |
|---|---|---|---|
| Agent-level | agent body 顶部，与 `model` / `role` 同级 | 该 agent 的所有 function 及其子作用域 | agent 身份的一部分，该 agent 所有调用共享的默认 context |
| Function-level | function body 顶部或中部 | 该 function 及其 block 子作用域 | 本条执行路径上的 context，**不传给它调用的其它 function** |
| Block-level | `if` / `for` / `loop` / `repeat` / `parallel for` 内 | 该 block 及其子作用域 | 某个分支 / 某次迭代专属的 context |

核心规则：**声明向下可见，调用不继承**。子作用域能看到父作用域的 `use`；function 或 agent 调用穿过 boundary 后，caller 的 function-local `use` 不会传给 callee。

### Agent-level `use`

写在 agent body 中，和 `model` / `role` / `description` 并列，属于 agent 的声明部分。

```agentscript
import file Playbook from "./playbook.md"

main agent Researcher {
    model Fast
    role "Researcher"
    description "Answer with playbook discipline."

    use Playbook as playbook

    main func(input) {
        generate({ input: input.question }) -> { text }
    }
}
```

含义："进入这个 agent 的任何 function 时，`Playbook` 默认作为 `playbook` context 注入。"

Agent-level `use` 是**声明式**的：

- 它描述 agent 的默认 context，是 agent 身份的一部分，和 `role` / `description` 同层。
- 表达式只能引用在 agent 顶层可解析的名字——实际上就是 `import file` 带入的文件。它不能依赖 function 参数、function 内的局部变量，也不能包含 call expression。
- 和 function-level `use` 一样，值的求值仍然延迟到 `generate` 构建 prompt 时发生。

如果想把一次 `memory.query` / tool 调用的结果挂成 context，仍然走"call 再 use"的函数内模式（见下文）。

### Function-level `use`

写在 function body 中。对本 function 及其 block 子作用域中后续的 `generate` 可见，**不会传给本 function 调用的其它 function**。

```agentscript
main func(input) {
    lessons = Lessons.query({ kind: "how-to" })
    use lessons as "past lessons"
    use input.question as "user question"

    generate({ input: input.question }) -> { text }
}
```

这是 call 结果进 context 的规范写法："call then use"：先把调用结果存进局部变量，再用 `use` 把它声明为 context。

### Block-level `use`

写在 `if` / `for` / `loop` / `repeat` / `parallel for` 的 body 中。只对该 block 及其子作用域可见，block 结束后丢弃，不影响外层。

```agentscript
use input.question as "user question"

if input.needs_detail {
    use input.detail as detail
    generate({ input: "Answer with detail" }) -> { text }
}
```

内部 `generate` 看到 `user question` 和 `detail`。离开 `if` block 后，`detail` 不再可见。

### 同 agent 内的 function 调用

Function 调用**不传递** caller 的 function-local `use`。被调用方看到的是它自己所在 agent 的 agent-level `use` 加上它自己函数体里声明的 `use`。

```agentscript
import file Doc0 from "./doc0.md"
import file Doc1 from "./doc1.md"
import file Doc2 from "./doc2.md"

main agent A {
    use Doc0 as base

    main func(input) {
        return b(input)
    }

    func b(input) {
        use Doc2 as detail
        a(input)
    }

    func a(input) {
        use Doc1 as reference
        generate({ input: input.question }) -> { text }
    }
}
```

`a` 内部 `generate` 看到的 context：

- `base`（agent-level `use Doc0`）
- `reference`（a 的 function-level `use Doc1`）
- 看不到 `detail`（b 的 function-local `use Doc2` 不传给 callee）

### 跨 agent 调用

通过 `import agent` 调用的 agent 有自己独立的 agent scope。Caller 的 agent-level 和 function-level context **都不会**进入 callee。

```agentscript
import agent Worker from "./worker.as"

main agent A {
    use Doc0 as base

    main func(input) {
        return Worker(input)
    }
}
```

`Worker` 内部的 `generate` 只看到 `Worker` 自己的 agent-level `use` 和被调用函数内声明的 `use`，看不到 `Doc0`。

### 设计意图

- **Agent 是 context boundary**：agent 同时是 capability boundary（决定能调用哪些 tool / llm / memory）和 context boundary（决定默认 context 是什么）。
- **Function 是执行单元，不是 context 单元**：function 调用组织执行路径，不隐式传递 context。要让 callee 看到某段 context，只能通过参数把数据显式传过去，在 callee 内自己 `use`。
- **Block 是局部 context 延展**：block scope 保证临时 context 不泄漏，支持"这段 context 只在某个分支里生效"的写法。

### Context 解析规则

任何一次 `generate` 的 context 集合，都可以从源码静态判定：

1. 先取所在 agent 的 agent-level `use` 声明。
2. 从包围该 `generate` 的 function 向外沿作用域链走：每一层作用域里，收集所有文本位置在该 `generate` 之前的 `use` 声明。
3. 忽略其它一切：caller 函数的 `use` 不进来，其它 agent 的 `use` 不进来，位置在该 `generate` 之后的 `use` 不进来。

由此得到几条实用后果：

- 单独看一次 `generate`，只需要读它所在的 function 体和 agent 体，就能枚举它看到的全部 context，不必跟踪调用链。
- 把一个 function 重构成若干小 helper，不会隐式改变任何 `generate` 看到的 context——helper 开始时 context 是空的。helper 要用的 context 要么来自共享的 agent-level `use`，要么通过参数显式传入后再 `use`。
- 工具和文档可以静态列出一个 agent 的默认 context surface（它的 agent-level `use` 集合），无需运行程序。

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
use results max 4k as "search results"
```

## Budget 语义

`use expr max budget` 是 context item budget，限制该 source 渲染进 prompt 的大小。

```agentscript
use docs.summary max 4k as evidence
```

裁剪是确定性的、保留结构的，不是语义摘要。字符串保留开头字符；list 按原顺序保留前缀元素；object 按 JavaScript 插入序保留可枚举字段前缀。如果内容优先级有语义含义，应先构造一个更小的值再 `use`，不要依赖 budget 对内容排序。

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
- agent-level `use` 是否仍保持声明式（不依赖 function-local 状态，不包含 call expression）？
