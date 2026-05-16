# AgentSpec

本文档定义 AgentSpec：一个用 JSON 描述 AgentScript agent 的结构化行为说明
书。AgentSpec 被设计成可以确定性地编译成当前合法的 AgentScript 源码。

语言参考见 [AgentScript Language](./language.md)。已有 `.as` 程序的选择点
优化见 [Optimizer Toolchain](./optimizer.md)。

## 用途

AgentSpec 不是新语言，不是 YAML config，不是 prompt 模板。它是一个 JSON
对象，承载作者本来要在 `.as` 源码里做的设计决定：

```text
用哪个模型
接收哪些输入
导入哪些工具、调用哪些方法
计算哪些中间值
其中哪些进入模型上下文
用哪个 agent pattern 决定控制流形态
generation 的指令是什么
输出契约是什么
```

设计契约是：

```text
任何通过 validator 的 AgentSpec，必须能编译成通过当前 parser/analyzer 的
AgentScript 源码。
```

这是 AgentSpec 作为 LLM 输出目标的关键意义：LLM 生成结构化对象而不是自由
`.as` 文本，validator 对引用和形状给出精确诊断，compiler 是 spec 到源码
的纯函数。

## 为什么用 JSON

AgentSpec 用 JSON，不用 YAML：

- JSON 对象 key 在 `JSON.stringify` 和 `JSON.parse` 下保持插入顺序，
  compiler 据此按作者顺序生成字段。
- LLM 结构化输出 API 原生针对 JSON。
- TypeScript 处理 JSON 不需要外部 parser。
- JSON 避免 YAML 缩进和解析歧义。

人审 spec 时可以用工具渲染成 YAML 风格文本。存储格式和 validator 的输入
始终是 JSON。

## Patterns

每个 AgentSpec 恰好对应一种 **pattern**，决定 compiler 在 `main func` 内
生成的控制流形态。Phase 1 支持两种 pattern：

| Pattern | 形态 | 适用场景 |
|---------|------|---------|
| `"linear"` | locals → use → generate | 一次性 RAG agent：tool call 一次后回答。 |
| `"react"` | locals → use → loop(reason → act → observe) → final generate | 迭代式 agent：根据已观察到的内容决定下一步检索什么。 |

`pattern` 字段是 spec 的判别字段：

```json
{ "version": "0.1", "pattern": "react", ... }
```

省略 `pattern` 等价于 `"linear"`，让既有 linear spec 在引入 `pattern` 后
仍然合法。

`pattern` 是**开放扩展点**。未来版本可能增加 `"plan_execute"`、
`"reflection"`，或者一个完全通用的 `"stages"` 形态（带小型表达式语言）。
增加新 pattern 是 additive 改动：`pattern: "linear"` 或 `pattern: "react"`
的 spec 行为不变。validator 遇到未知 pattern 时返回
`UNSUPPORTED_PATTERN` 诊断，不静默放过。

每种 pattern 都有自己的顶层 pattern 块（`react: { ... }`、未来的
`plan_execute: { ... }` 等）。使用某个 pattern 时其 pattern 块必须存在；
使用其他 pattern 时该 pattern 块禁止出现。

## 顶层结构

```json
{
  "version": "0.1",
  "pattern": "react",
  "agent":         { ... },
  "model":         { ... },
  "inputs":        { ... },
  "tools":         [ ... ],
  "locals":        [ ... ],
  "model_context": [ ... ],
  "react":         { ... },
  "generation":    { ... },
  "output":        { ... },
  "assumptions":   [ ... ]
}
```

无论哪种 pattern 都必填的字段：`version`、`agent`、`model`、`inputs`、
`tools`、`locals`、`model_context`、`generation`、`output`。

可选字段：`pattern`（默认 `"linear"`）、`assumptions`。

Pattern 相关字段：

| Pattern | 必填的 pattern 块 | 禁止出现的 pattern 块 |
|---------|-------------------|----------------------|
| `"linear"` | 无 | `react` |
| `"react"` | `react` | （目前无；未来加入新 pattern 时归入此处） |

`version` 必须是字符串 `"0.1"`。未来 schema 升级会提升此版本号；validator
拒绝未知版本。

## `agent`

标识 agent。

```json
{
  "agent": {
    "name": "DocsAssistant",
    "role": "Documentation assistant",
    "description": "Answer questions from documentation with citations."
  }
}
```

| 字段 | 类型 | Lowering |
|------|------|----------|
| `name` | 标识符，匹配 `/^[A-Z][A-Za-z0-9_]*$/` | `main agent <name>` |
| `role` | 非空字符串 | `role "<role>"` |
| `description` | 非空字符串 | `description "<description>"` |

Phase 1 只生成单个 `main agent`。多 agent 的 spec 不在范围内。

## `model`

指定 LLM 提供方。

```json
{
  "model": {
    "import_name": "Qwen",
    "uri": "ollama://localhost:11434/qwen3.6"
  }
}
```

| 字段 | 类型 | Lowering |
|------|------|----------|
| `import_name` | 标识符，匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/` | `import llm <import_name>` |
| `uri` | 非空字符串 | `import llm ... from "<uri>"` |

compiler 生成一行 `import llm`。`import_name` 同时作为生成 agent 的
`model` config 值。所有 `generate` 调用（包括 ReAct 的 reason 步骤）共用
同一个模型。

## `inputs`

声明入口函数的输入契约。

```json
{
  "inputs": {
    "message": { "type": "string", "required": true },
    "customer_id": { "type": "string", "required": true }
  }
}
```

key 是输入字段名，匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/`。value 声明类型。
Phase 1 把所有 input 视为 required；`required` 字段允许出现但不影响
lowering。

`inputs` lower 到 `main func` 的 contract block：

```agentscript
main func(input {
    message: string
    customer_id: string
}) { ... }
```

字段顺序按 JSON 对象 key 顺序生成。

`inputs` 至少包含一个字段。

## `tools`

声明 tool import 与 spec 用到的方法。

```json
{
  "tools": [
    {
      "import_name": "Docs",
      "uri": "mcp://support-docs",
      "methods": [
        { "name": "search", "purpose": "Search support documentation." }
      ]
    }
  ]
}
```

每个 entry：

| 字段 | 类型 | Lowering |
|------|------|----------|
| `import_name` | 标识符，匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/` | `import tool <import_name>` |
| `uri` | 非空字符串 | `import tool ... from "<uri>"` |
| `methods` | 非空数组 | 不 lower（仅 validator 用） |

每个 method：

| 字段 | 类型 | 用途 |
|------|------|------|
| `name` | 标识符，匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/` | `locals[*].source` 和 `react.act` 的引用目标 |
| `purpose` | 非空字符串 | 仅文档 |

methods 不 lower 到 import 或源码任何地方。它的存在是让 validator 能检查
每个 tool 方法调用都声明了它要调用的方法名，从而在运行前抓住拼写错误。

compiler 按数组顺序生成一行 `import tool`。

## `locals`

声明**进入循环之前**由 tool call 计算的中间值。`linear` spec 里这是仅有
的 tool call；`react` spec 里这些 local 在循环开始前执行一次（例如初始
文档检索）。

```json
{
  "locals": [
    {
      "name": "refund_docs",
      "source": {
        "kind": "tool_call",
        "tool": "Docs",
        "method": "search",
        "args": { "query": "input.message" }
      }
    }
  ]
}
```

每个 entry：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | 标识符，匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/` | local 变量名 |
| `source.kind` | 字面量 `"tool_call"` | Phase 1 唯一支持的 kind |
| `source.tool` | 字符串 | 必须命中某个 `tools[*].import_name` |
| `source.method` | 字符串 | 必须命中该 tool 的某个 method |
| `source.args` | object | 传给 tool call |

Phase 1 仅支持 `tool_call` 一种 source kind。未来可能加入 `literal`、
`derived` 等其它 kind。

`args` 的 key 匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/`。value 是表达式字符串：

| value 形式 | Lowering |
|-----------|----------|
| `"input.<field>"` | `input.<field>`（标识符表达式） |
| `"local.<name>"` | `<name>`（去掉 `local.` 前缀） |
| 其它 | 字符串字面量（用 `JSON.stringify`） |

local 顺序有意义。引用 `local.X` 的 local 必须排在 `X` 之后；validator
对违反此规则的情况报 `FORWARD_LOCAL_REF`。

`locals` 可以是空数组（例如纯 ReAct agent，所有工作都在循环里完成）。

每个 `locals` 条目 lower 到一条赋值语句：

```agentscript
refund_docs = Docs.search({
    query: input.message
})
```

按数组顺序生成，相邻 local 之间一个空行。

## `model_context`

声明哪些值进入模型 prompt。这是整个 spec 的审计点：未列入此处的值对模型
不可见。

```json
{
  "model_context": [
    { "source": "input.message", "label": "user message" },
    { "source": "local.refund_docs", "label": "support documentation", "max": "8k" }
  ]
}
```

每个 entry：

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | `"input.<field>"` 或 `"local.<name>"` | 引用必须解析 |
| `label` | 非空字符串 | 作为 `as` 标签字面量 |
| `max` | 可选字符串，匹配 `/^\d+k?$/` | 作为 `max` budget |

按数组顺序 lower 到 `use` 语句：

```agentscript
use input.message as "user message"
use refund_docs max 8k as "support documentation"
```

`source` 解析与 `locals[*].source.args` 相同：

- `"input.<field>"` → `input.<field>`
- `"local.<name>"` → `<name>`

`model_context` 不允许其它形式。Phase 1 不支持自由表达式；需要的用户应
手写 `.as`。

`model_context` 至少包含一个条目。

`local.<name>` 引用必须命中已声明的 local。**已声明但未列入
`model_context` 的 local 是合法的**——这正是 spec 表达"计算这个值但不展示
给模型"的方式。

`react` spec 里 `model_context` 是**外层**上下文，对循环内的 reason
generate 和循环外的最终 generate 都可见。ReAct 的 `scratch` 在同一个
外层 scope 里被自动 `use`，使用 `react.scratch` 声明的 label 和 budget。

## `generation`

声明**最终**的 LLM 调用（在 ReAct 中是循环之后的那次；linear 里是唯一
那次）。

```json
{
  "generation": {
    "input": "Answer the customer from the provided context. Cite policy claims.",
    "max_output": 1200
  }
}
```

| 字段 | 类型 | Lowering |
|------|------|----------|
| `input` | 非空字符串 | `generate({ input: "..." })` |
| `max_output` | 可选正整数 | `generate({ ..., max_output: N })` |

Phase 1 只支持 `input` 和 `max_output`。其它 `generate` 选项（`attempts`、
`temperature`、`think`、`strict`、`debug`）不通过 AgentSpec 暴露；需要的
用户应手写 `.as`。

## `output`

声明**最终** `generate` 的输出契约。

```json
{
  "output": {
    "fields": {
      "answer": { "type": "string" },
      "citations": { "type": "list[json]" },
      "confidence": { "type": "number" },
      "missing_information": { "type": "list[string]" }
    }
  }
}
```

`fields` 的 key 匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/`。value 声明类型。

`output.fields` 至少包含一个字段。

`output` lower 到最终 `generate` 后的 contract block：

```agentscript
return generate({
    input: "...",
    max_output: 1200
}) -> {
    answer: string
    citations: list[json]
    confidence: number
    missing_information: list[string]
}
```

字段顺序按 JSON 对象 key 顺序生成。

## `react`（ReAct 模式）

`pattern == "react"` 时必填。声明迭代式的 reason → act → observe 循环。

```json
{
  "react": {
    "max_iterations": 6,
    "scratch": {
      "label": "observations",
      "max": "4k"
    },
    "reason": {
      "input": "Look at the observations so far. Pick the next focused query, or set done=true if you can answer.",
      "max_output": 400,
      "output": {
        "fields": {
          "focus": { "type": "string" },
          "done": { "type": "boolean" }
        }
      }
    },
    "act": {
      "tool": "Search",
      "method": "query",
      "args": { "q": "thought.focus" }
    },
    "stop_when": "thought.done"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `max_iterations` | 正整数 | lower 到 `loop until done max <N>`。 |
| `scratch.label` | 非空字符串 | `use scratch.summary` 的 label。 |
| `scratch.max` | 字符串，匹配 `/^\d+k?$/` | `use scratch.summary` 的 budget。 |
| `reason.input` | 非空字符串 | reason `generate` 的 instruction。 |
| `reason.max_output` | 可选正整数 | reason `generate` 的 budget。 |
| `reason.output.fields` | 非空 object | reason 输出契约，形态与顶层 `output.fields` 相同。 |
| `act.tool` | 字符串 | 必须命中 `tools[*].import_name`。 |
| `act.method` | 字符串 | 必须命中该 tool 的某个 method。 |
| `act.args` | object | act tool call 的入参。 |
| `stop_when` | 字符串 `"thought.<field>"` | 必填。`<field>` 必须是 `reason.output.fields` 中声明的 `boolean` 字段。 |

### `react.act.args` 中的表达式字符串

`args` value 支持三种形式：

| value 形式 | 解析 |
|-----------|------|
| `"input.<field>"` | 指向 `main func` input |
| `"local.<name>"` | 指向循环之前的 local |
| `"thought.<field>"` | 指向最近一次 reason 输出的某个字段 |
| 其它 | JSON 字符串字面量 |

`thought` 是 compiler 在循环体内为 reason 输出绑定的名字。循环 scope 内
其他生成绑定（`scratch`、`done`、`obs`）是保留名，不允许作为表达式 root
出现。

### Lowering

compiler 按以下顺序生成：

1. imports 与 agent 声明（与 linear 共用）。
2. `main func(input { ... }) {`。
3. `locals` 赋值（共用；循环之前的 tool call）。
4. `model_context` 的 `use` 语句（与 linear 共用）。
5. `scratch = []`。
6. `use scratch.summary max <react.scratch.max> as "<react.scratch.label>"`。
7. `done = false`。
8. ```
   loop until done max <react.max_iterations> {
       thought = generate({
           input: "<react.reason.input>",
           max_output: <react.reason.max_output>   // 缺省时省略
       }) -> {
           <reason.output.fields，形态同顶层 output>
       }

       obs = <react.act.tool>.<react.act.method>({
           <args 解析后的形态>
       })
       scratch.add(obs)
       done = <stop_when 解析为标识符>
   }
   ```
9. `return generate({ ... }) -> { ... }`，由 `generation` 和 `output` 生成
   （与 linear 共用）。

`stop_when: "thought.done"` lower 为 `done = thought.done`。validator 保证
`<field>` 是 `reason.output.fields` 中的 boolean 字段。

### Phase 1 ReAct 限制

- 每次迭代恰好一次 `act` tool call。多步 act（从 list 选 tool、零工具
  迭代）不在 Phase 1 范围。
- `stop_when` 必填。纯靠 max-iteration 触底退出的 loop 不在范围；如果
  需要，请等 Phase 2 引入对应 pattern。
- `scratch` 是平铺的 observations list。结构化 scratch（object、按迭代
  附加 metadata）不在范围。

## 类型系统

AgentSpec 类型直接映射到 AgentScript contract 类型：

| AgentSpec 类型 | AgentScript contract 类型 |
|----------------|---------------------------|
| `"string"` | `string` |
| `"number"` | `number` |
| `"boolean"` | `boolean` |
| `"json"` | `json` |
| `"list[string]"` | `list[string]` |
| `"list[number]"` | `list[number]` |
| `"list[boolean]"` | `list[boolean]` |
| `"list[json]"` | `list[json]` |

这是 Phase 1 唯一支持的集合，对 input/output 契约和
`react.reason.output.fields` 都适用。嵌套 object contract、自定义类型名、
optional 字段都无法表达。需要更复杂结构时用 `json` 或 `list[json]`。

这个限制遵循 AgentScript 的 contract 类型系统——它本身就是窄的。AgentSpec
不扩展它。

## `assumptions`

可选的字符串数组，记录 spec 撰写过程中做出的设计决定。

```json
{
  "assumptions": [
    "If documentation is insufficient, fill missing_information.",
    "Citations are required for factual claims."
  ]
}
```

assumptions 不 lower 到源码。它是 spec 作者的清单：LLM 生成的 spec 默认
做了哪些假设、用户可能想审视。审查工具可以把 assumptions 展示在 review UI
中。

## 验证规则

validator 必须在 compile 之前对每个 spec 做检查。Phase 1 覆盖：

### Schema check

- 必填字段存在。
- `version` 等于 `"0.1"`。
- 标识符匹配上文规定的模式。
- 必填字符串非空。
- `inputs`、`tools[*].methods`、`output.fields` 非空。
- `locals[*].source.kind` 是 `"tool_call"`。
- `args` 和 `output.fields` 的 key 匹配标识符模式。
- boolean 字段、integer 字段和表达式字符串字段必须使用预期 JSON 类型。
  错误码：`INVALID_TYPE`。
- `max_output`、`react.max_iterations` 这类正整数值必须大于 0。错误码：
  `INVALID_VALUE`。
- 不支持的 source kind 返回 `UNSUPPORTED_KIND`。

### Pattern check

- `pattern`（如存在）必须是 `"linear"` 或 `"react"`。其他值返回
  `UNSUPPORTED_PATTERN`。省略 `pattern` 视为 `"linear"`。
- 必填的 pattern 块存在，禁止出现的 pattern 块缺席。错误码：
  `MISSING_PATTERN_BLOCK`、`UNEXPECTED_PATTERN_BLOCK`。

### Type check

每个 `type` 值在支持集合中，包括 `inputs`、`output.fields` 和
`react.reason.output.fields`。

### Tool reference check

每个 `locals[*].source.tool` 和 `react.act.tool` 命中已声明的 tool；
对应的 `method` 命中该 tool 的某个 method。

### Reference check

每个 `"input.<field>"` 引用（在 `args`、`model_context`、
`react.act.args` 中）命中已声明的 input。每个 `"local.<name>"` 引用命中
已声明的 local。`locals` 内的前向引用被拒绝。

### Binding uniqueness check

生成出的 AgentScript binding 不能冲突。agent name、`model.import_name`、
每个 `tools[*].import_name`、每个 `locals[*].name` 在 compiler 生成的作用域
内必须唯一。local name 也不能是 `input`，因为 `input` 是入口函数参数。
错误码：`DUPLICATE_BINDING`。

### React 专项检查

`pattern == "react"` 时：

- `react.max_iterations` 是正整数。
- `react.scratch.label` 非空；`react.scratch.max` 匹配 `/^\d+k?$/`。
- `react.reason.output.fields` 非空，类型受支持。
- `react.act.tool` 与 `react.act.method` 解析成功。
- `react.act.args` 的 value 遵循三形式规则。`"thought.<field>"` 引用必须
  命中 `react.reason.output.fields` 中声明的字段。错误码：
  `UNKNOWN_THOUGHT_REF`。
- `react.stop_when` 是字面量 `"thought.<field>"`，且 `<field>` 是
  `react.reason.output.fields` 中声明的 boolean 字段。错误码：
  `INVALID_STOP_WHEN`、`UNKNOWN_THOUGHT_REF`、`STOP_WHEN_NOT_BOOLEAN`。
- 标识符 `thought`、`obs`、`scratch`、`done` 是 ReAct lowering 保留名。
  它们不允许作为 `inputs` 的 key 或 `locals` 中的 name 出现，因为这些
  名字会成为运行时绑定。contract field name 不能是 `thought`、`obs` 或
  `scratch`；`done` 允许出现，因此 `thought.done` 仍然合法，也是常见的
  `stop_when` 形态。错误码：`RESERVED_IDENTIFIER`。linear spec 不受此限制。

### Model context check

`model_context` 非空。每个 `source` 解析成功。每个 `label` 非空。每个
`max`（如存在）匹配 `/^\d+k?$/`。

validator 不检查：

- URI 是否可达。
- tool method 的运行时签名是否匹配。
- `generation.input` 或 `react.reason.input` 的语义内容。
- policy 或安全约束。

## 编译

compiler 是确定性函数。相同输入产生相同输出。compiler 不调用 LLM。

算法：

1. 跑 validator。如有 error 级诊断，拒绝编译。
2. 为 `model` 生成 `import llm`。
3. 按 `tools` 数组顺序为每个 entry 生成 `import tool`。
4. 生成 `main agent <name> {` 以及 `model`、`role`、`description` 行。
5. 生成 `main func(input { ... }) {`。
6. 按数组顺序生成 `locals` 赋值，相邻语句间一个空行。
7. 按数组顺序生成 `model_context` 的 `use` 语句。
8. 按 `pattern` 分发：
   - `"linear"`：直接生成
     `return generate({ ... }) -> { ... }`，使用 `generation` 和 `output`。
   - `"react"`：依次生成 `scratch = []`、scratch `use` 语句、
     `done = false`、`loop until done max N { ... }` 块（按 ReAct
     lowering 规则）、最后由 `generation` 和 `output` 生成
     `return generate(...) -> { ... }`。
9. 关闭所有开括号。

字符串字面量按 JSON 风格转义生成（等价于 `JSON.stringify`）。生成的源码
必须通过当前 parser 和 semantic analyzer。

## 限制

Phase 1 故意不支持：

- `"linear"` 和 `"react"` 之外的 pattern。
- 通用 `stages` 形式（带自由表达式语言）—— 留作未来 pattern。
- `main func` 内的条件分支（`if` / `else`）。
- 多重循环、嵌套循环、`parallel for`。
- 同一次 ReAct 迭代里多次 act 或不同 act tool 的选择。
- 一个 agent 有多个函数。
- 一个 spec 有多个 agent。
- agent 间调用。
- `use one of` 候选槽。
- memory import (`import memory`)。
- file import (`import file`)。
- agent import (`import agent`)。
- 对 capability binding 的 `use`。
- 非 tool_call 的 local（字面量、计算表达式、成员访问）。
- 嵌套 object contract。
- 可选 input 字段。

需要这些特性的 spec 应该手写，或者用户在 compile 后扩展生成的源码。未来
版本的 AgentSpec 通过引入新 pattern 扩展覆盖范围。

## 相关文档

- [AgentScript Language](./language.md) — 完整语言参考。
- [`use ... as ...`](./use-as.md) — 上下文选择规则。
- [`generate`](./generate.md) — generate 站点规则与输出契约。
- [Optimizer Toolchain](./optimizer.md) — `host://optimizer` 用于已有
  程序的变体选择。
