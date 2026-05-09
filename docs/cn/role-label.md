# AgentScript Role / Label 设计

本文档定义 AgentScript 中 `agent role`、`context label` 和底层 provider message role 的分层设计，用于指导当前 prompt 构造、`use ... as ...` 语法和 trace 展示的实现。

## 1. 核心结论

AgentScript 应明确区分三类概念：

```text
agent role 表示“谁在生成 / 谁在发言”。
context label 表示“这段上下文在当前 prompt 中的用途”。
provider role 表示底层 LLM API message 的 system/user/assistant/tool。
```

这三者属于不同层级，不能混用。

- `agent role` 是 AgentScript 层的生成身份。
- `context label` 是 prompt 内部的上下文组织标签。
- `provider role` 是 OpenAI / Anthropic / Ollama 等 adapter 的传输协议细节。

用户不应通过 `use ... as system` 之类的写法直接操纵底层 provider role。

## 2. Agent Role

`role` 是 agent 的身份声明：

```agentscript
agent ResearchAgent {
    model Qwen
    role "Senior Researcher"
    description "Answer questions with search and structured reasoning."
}
```

它的含义是：

```text
当前 agent 以什么身份进行 generate。
```

每次 `generate` 都应把当前 agent 的 `role` 和 `description` 放入 identity 层 prompt。例如：

```text
You are a Senior Researcher.
Answer questions with search and structured reasoning.
```

因此当前实现目标是：

```text
agent.role -> generation identity
agent.description -> generation identity
```

在 multi-agent 场景中，agent 输出被其他 agent 使用时，`role` 也可以作为 speaker provenance 展示：

```text
[plan]
Produced by: Planner
Role: Planner
Output:
...
```

这里的 `Role: Planner` 仍然是 AgentScript 层的 agent role，不是 provider message role。

## 3. Context Label

Context label 是 `use` 注入上下文时的语义标签。

当前语法支持：

```agentscript
use expr
use expr < budget
use expr as label
use expr < budget as label
```

固定顺序是：

```text
选择什么 -> 限制多少 -> 作为何种上下文
```

例如：

```agentscript
use input.question as user
use scratch.summary < 2k as memory
use docs.summary < 4k as evidence
use search_result as observation
use policy as constraint
```

`context label` 的含义是：

```text
这段内容在当前 generate prompt 中作为何种材料被呈现。
```

它只影响：

- prompt section label
- trace display
- context organization
- debug / audit readability

它不改变：

- agent identity
- provider message role
- tool 权限
- system / user / assistant 权限

## 4. Provider Role

Provider role 是底层 LLM API 的 message role，例如：

```text
system
user
assistant
tool
```

它属于 provider adapter 的实现细节。

默认映射：

```text
system = 当前 agent identity + runtime rules
user   = generate instruction + selected context + output shape
```

也就是说，AgentScript 的 context label 应作为 prompt 内部结构渲染，而不是映射为多条 provider message role。

Runtime 不把 memory、evidence、observation 等材料伪装成 assistant message：

```text
assistant: [memory] ...
assistant: [evidence] ...
```

原因是 `assistant` 在 chat protocol 中表示模型真实历史输出，而 memory / evidence / observation 是外部材料。

## 5. Prompt 构造模型

一次 `generate` 的 prompt 分为四层。

### 5.1 Agent Identity

来自当前 agent 的配置：

```agentscript
role "Senior Researcher"
description "Answer questions with search and structured reasoning."
```

渲染为 provider `system` message 的一部分：

```text
You are a Senior Researcher.
Answer questions with search and structured reasoning.
```

### 5.2 Generate Instruction

来自 `generate(...)` 的 `input` 字段：

```agentscript
generate({
    input: "Answer using only the selected context"
}) -> {
    ok boolean
    answer string
}
```

渲染为：

```text
Instruction:
Answer using only the selected context.
```

### 5.3 Selected Context

来自当前 scope 和父 scope 中可见的 `use` 声明：

```agentscript
use input.question as user
use scratch.summary < 2k as memory
use docs.summary < 4k as evidence
```

渲染为：

```text
Context:

[user]
...

[memory]
...

[evidence]
...
```

如果没有 label，可以使用 source expression 作为默认 label 或显示为普通 context item。

### 5.4 Output Shape

来自 `generate(...) -> shape`：

```agentscript
generate({ input: "Answer" }) -> {
    ok boolean
    answer string
}
```

渲染为：

```text
Required output shape:
{
  ok: boolean
  answer: string
}
```

当 `generate` 没有 `-> shape` 时，不应注入输出 schema，也不应要求 provider 结构化输出。

## 6. `use ... as label` 规则

### 6.1 Label 类型

`as` 后面的 label 是语法层面的字面标签，不是表达式，不参与变量解析，也不会求值。

```agentscript
use docs as evidence
use scratch as memory
use docs.summary < 4k as retrieved-evidence
```

其中：

```text
evidence
memory
retrieved-evidence
```

都是 context label 的字面值。即使当前作用域中存在名为 `evidence` 或 `memory` 的变量，`as evidence` 和 `as memory` 也不会读取这些变量。

Label 不需要双引号。它不是字符串表达式，而是 `use` 语句的一部分：

```agentscript
use docs as retrieved evidence
```

上例中的 label 是字面标签 `retrieved evidence`。Parser 应把 `as` 之后到语句结束之间的内容作为 label 文本；如果存在预算，则 label 位于预算之后：

```agentscript
use docs.summary < 4k as retrieved evidence
```

Label 文本应在 AST 中保存为普通字符串，例如：

```json
{
  "label": "retrieved evidence"
}
```

Label 不支持嵌套表达式、函数调用、字段访问或插值：

```agentscript
use docs as label_name      -- label 是 "label_name"，不是变量 label_name 的值
use docs as input.label     -- label 是 "input.label"，不是字段访问结果
use docs as label()         -- label 是 "label()"，不会调用函数
```

### 6.2 保留 label

为避免和 provider role 混淆，以下 label 保留，不作为普通 context label 使用：

```text
system
assistant
tool
developer
```

`user` 允许作为 context label，但它只是 context label，不是 provider role：

```agentscript
use input.question as user
```

这里的 `user` 表示“这段上下文是用户输入”，不是把该 context item 变成 provider `user` message。

### 6.3 继承规则

`use` 声明原本可被 child scope 继承。加入 label 后，label 应随 use declaration 一起继承。

```agentscript
use input.question as user

func answer() {
    generate({ input: "Answer" }) -> {
        answer string
    }
}
```

`answer()` 内部的 `generate` 仍可看到：

```text
[user]
input.question
```

### 6.4 重复 label

允许多个 context source 使用同一个 label：

```agentscript
use docs1 as evidence
use docs2 as evidence
```

重复 label 按声明顺序分别渲染：

```text
[evidence]
docs1...

[evidence]
docs2...
```

## 7. Multi-Agent Provenance

Agent 调用结果应在 trace 或内部 metadata 中保留 provenance：

```json
{
  "agent": "Planner",
  "role": "Planner",
  "function": "main",
  "trace_id": "..."
}
```

这类 metadata 不一定暴露给用户代码，但应可用于 trace 和 context renderer。

用法：

```agentscript
plan = Planner(input)
critique = Critic(plan)

use plan.summary < 2k as plan
use critique.summary < 2k as critique
```

渲染时可以结合 provenance：

```text
[plan]
Produced by: Planner
Role: Planner
Output:
...

[critique]
Produced by: Critic
Role: Skeptical Reviewer
Output:
...
```

这样能表达 multi-agent 中“不同角色发言”的感觉，同时不污染 provider message role。

## 8. Trace 展示

Trace 同时显示 agent identity、instruction、context label、source expression 和 budget。

```text
Generate #1
Agent:
  name: ResearchAgent
  role: Senior Researcher

Instruction:
  Answer using only the selected context.

Selected context:
  [user]
  source: input.question
  budget: none

  [memory]
  source: scratch.summary
  budget: 2k

  [evidence]
  source: docs.summary
  budget: 4k

Output shape:
  ok boolean
  answer string
```

Multi-agent trace 可以显示：

```text
Agent call:
  Planner.main
  role: Planner

Agent call:
  Critic.main
  role: Skeptical Reviewer

Generate #3
Agent:
  Coordinator
  role: Coordinator

Selected context:
  [plan]
  produced_by: Planner
  producer_role: Planner

  [critique]
  produced_by: Critic
  producer_role: Skeptical Reviewer
```

## 9. 当前实现方案

当前实现包括：

1. `role` 和 `description` 进入每次 `generate` 的 system / identity prompt。
2. `UseStmt` 增加可选 `label` 字段，保存 label 字面文本。
3. Parser 支持 `use expr as label` 和 `use expr < budget as label`。
4. Parser 将 `as` 后面的 label 保存为原始标签文本，不按表达式解析。
5. Semantic analyzer 校验保留 label，避免和 provider role 混淆。
6. Context builder 在 trace 和 prompt renderer 中使用 label。
7. Agent call trace 保留 agent name、role、function 等 provenance。

当前设计保持执行和上下文注入分离：

```agentscript
critique = Critic(draft)
use critique as critique
```

## 10. 术语表

```text
provider role:
  底层 chat message role，例如 system/user/assistant/tool。

agent role:
  agent 生成输出时使用的身份，也可作为 agent 输出的 speaker provenance。

context label:
  通过 use ... as ... 附加到 selected context 的用途标签。

speaker provenance:
  agent 调用产物携带的来源元信息，包括 agent name、role、function 和 trace id。

agent transcript:
  在 prompt 或 trace 中按 agent 来源组织的多 agent 输出展示形式。
```

## 11. 一句话总结

```text
provider role 是消息协议；
agent role 是生成身份和发言者身份；
context label 是上下文用途标签。
```

AgentScript 应在语言层构造 labeled context 和 agent transcript，再由 runtime 映射到底层 provider messages。
