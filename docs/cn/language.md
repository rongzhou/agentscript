# AgentScript 语言参考

本文档描述 AgentScript v0.1.x 的当前语言规范。

## 设计原则

- Agent 是执行和 prompt 身份的基本单元。
- 上下文显式化：普通变量、工具结果、memory 记录和 trace 事件不会自动进入 prompt，除非通过 `use` 显式选择。
- 作用域控制变量生命周期、上下文继承和 prompt 暴露边界。
- import 的 llm、tool、memory、file 和 agent 是具有明确边界的运行时能力。
- planner、executor、verifier、reflect、improve 和 evolve 等模式名保持为普通标识符。
- Trace 是调试和审计产物，不是 prompt context。

## 相关设计文档

本文档是紧凑的语法和语言特性索引。详细设计文档包括：

- [`use ... as ...`](./use-as.md)：prompt context 选择、label、budget、scope 可见性、延迟求值和 trace。
- [`generate`](./generate.md)：generation site、prompt 构造、agent identity、输出契约、provider hint、校验、重试和 trace。
- [Contract block 中的 label-only 字段](./generate-default-string-fields.md)：`generate` 输出 contract 中基于 default value 的简写规则。
- [`parallel for`](./parallel-for.md)：面向独立有界 list 工作的结构化并行。
- [Final Expression Return](./final-expression-return.md)：函数体最后一个顶层表达式的隐式返回规则。
- [npm 和 node tools](./npm-tools.md)：在 AgentScript 中调用 npm 包和 Node 内置模块。
- [Optimizer Toolchain](./optimizer.md)：用于 inspect、trial 和 specialize `use one of` 变体的 `host://optimizer` 工具。
- [AgentSpec](./agent-spec.md)：JSON 蓝图格式，可以确定性地编译成 AgentScript 源码。

## 程序结构

程序由 import 声明和 agent 声明组成。执行从选定的 agent 和函数开始，或者从程序的 `main agent` 和 `main func` 开始。

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent Assistant {
    model Qwen
    role "Assistant"
    description "Answer with structured JSON."

    main func(input {
        question: string
    }) {
        use input.question
        generate({ input: "Answer the question" }) -> {
            ok: boolean
            answer
        }
    }
}
```

## Import

AgentScript 支持五种资源类型：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Find from "sh://find"
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import file Requirements from "./requirements.md"
import agent Worker from "./worker.as"
```

资源绑定是显式能力声明。`llm`、`tool`、`memory`、`agent` 绑定不能通过 `use` 直接加入 prompt context。File import 是只读上下文资源，仍需显式 `use`。

### LLM URI

```agentscript
import llm Fast from "openai://gpt-4.1-mini"
import llm Strong from "anthropic://claude-sonnet-4-0"
import llm Local from "ollama://localhost:11434/qwen3.6"
```

环境变量：
- `OPENAI_API_KEY` / `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
- `OLLAMA_BASE_URL`

### Tool URI

工具使用 URI scheme 进行分发：

| Scheme | Provider | 示例 |
|--------|----------|------|
| `sh://` | 基于 shell 的工具 | `sh://find`, `sh://grep`, `sh://read-range` |
| `file://` | 文件操作 | `file://workspace` |
| `env://` | 环境变量 | `env://process` |
| `http://` / `https://` | HTTP 请求 | `https://api.example.com` |
| `mcp://` | 外部 MCP 工具 | `mcp://tools/search` |
| `host://optimizer` | 内置 optimizer toolchain | `host://optimizer` |
| `host://architect` | 内置 AgentSpec compiler toolchain | `host://architect` |
| `node:` | Node 内置模块（需 `agentscript.npm.json`） | `node:path`, `node:fs/promises` |
| `npm:` | npm 包（需 `agentscript.npm.json`） | `npm:yaml`, `npm:@scope/util` |

### Memory URI

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import memory Runs from "sqlite://./.agentscript/memory.db#runs"
```

File memory 使用 JSONL 格式。SQLite memory 使用固定 schema，支持命名空间隔离。

### File URI

相对路径基于导入的 `.as` 文件目录解析（REPL 中基于当前工作目录）。路径访问限制在 workspace 根目录内。

## Agent 和函数

Agent 包含配置和函数。函数创建运行时作用域。跨 Agent 调用创建独立的函数作用域和嵌套的 trace 事件。

```agentscript
result = Worker(input)
result = Worker.run(input)
```

`AgentName(input)` 调用目标 agent 的 `main func`。`AgentName.funcName(input)` 调用指定的命名函数。

函数可以隐式返回最后一个顶层表达式。完整规则见 [Final Expression Return](./final-expression-return.md)。

### 入口规则

- 一个程序最多一个 `main agent`。
- 一个 agent 最多一个 `main func`。
- 多 Agent 程序必须声明 `main agent`。
- `main agent { ... }` 可以省略 agent 名称。
- `main func(input) { ... }` 可以省略函数名称。

## 配置

`model`、`role`、`description` 是作用域配置值，供 `generate` 使用。

```agentscript
agent A {
    model Qwen
    role "Researcher"
    description "Collect facts and answer carefully."
}
```

子作用域可以覆盖这些值：

```agentscript
func careful(input) {
    model Strong
    role "Specialist"
    ...
}
```

## 值和 Contract Block

运行时值以 JSON 为核心：

- `string`、`number`、`boolean`、`none`
- `list`、`object`

Contract block 用于描述结构化入口输入和结构化 `generate` 输出：

```agentscript
main func(input {
    question: string
    max_results: number
}) {
    ...
}

generate({ input: "Extract facts" }) -> {
    ok: boolean
    title
    items: list[json]
    meta: json
}
```

Contract 字段使用换行分隔的 `label: value` 条目。字段之间不允许逗号。Label-only 字段表示 `label: default_value`；default value 由 contract 的使用位置定义。`generate` 输出 contract 将 label-only 字段默认为 `string`，所以 `title` 等价于 `title: string`。Input contract 没有定义 default value，必须显式写作 `label: value`。

支持的 contract 类型：`string`、`number`、`boolean`、`json`、`list`、`list[T]`（T 为任意支持的类型）。

Contract block 用在语言期待具名结构块的位置：函数 input 参数和 `generate(...) -> { ... }` 输出契约。`use one of { ... }` 沿用同一套 contract block 约定来书写候选条目，但它的 value 是候选表达式，不是 contract type，并且不定义 label-only default value。`generate({ ... })` 的参数本身是 JSON-like options object，不是 contract block。Contract block 不是对象字面量，也不是完整的静态类型系统。

对象字面量使用 JSON-like 语法：字段写作 `key: value`，多字段之间必须用逗号分隔。

## 显式上下文（`use`）

`use` 选择在当前作用域及其子作用域中，后续 `generate` 可以包含哪些变量的值。

```agentscript
use input.question
use Requirements max 4k
use past_lessons max 2k
use input.question as user
use docs.summary max 4k as evidence
```

### 规则

- 未被 `use` 的变量不会进入 prompt。
- 工具输出不会自动进入 prompt。
- Memory 查询结果不会自动进入 prompt。
- Trace 事件不会自动进入 prompt。
- `use value max n` 应用上下文预算。
- `use value as label` 为选中的 context source 附加字面标签。
- `use value max n as label` 先应用预算，再附加标签。
- `llm`、`tool`、`agent`、`memory` 绑定不能被 `use`。
- 函数绑定不能被 `use`。
- `use` 声明被子作用域继承。

### Context label

`as` 后面的 label 是字面标签文本，必须是单个 identifier 或 string literal。它不是表达式，不会求值，也不会读取作用域中的变量。

```agentscript
use docs as evidence
use docs.summary max 4k as "retrieved evidence"
use input.question as user
```

即使当前作用域中存在名为 `evidence` 的变量，`as evidence` 也只是把 context section 标记为 `evidence`。Label 用于组织 prompt section 和 trace 输出；它不会改变 `system`、`user`、`assistant` 等 provider message role。

### 延迟求值

`use expr max budget` 声明的是 context source，而不是当前值的快照。当 `generate` 构建 prompt 时，表达式会被重新求值。这意味着在 `use` 之后、`generate` 之前对变量的修改在生成时刻是可见的。

完整设计语义见 [`use ... as ...`](./use-as.md)。

### 可选择 context：`use one of`

`use one of` 让单个 context slot 变成可选择位点，同时不把优化结果藏进 runtime state。它保持 `use` 的语义，但允许在一个共享 label 下声明多个候选 source：

```agentscript
use one of {
    none:     empty
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    grounded: docs.top5 max 4k selected
} as "evidence"
```

一次可见的 `generate` 构建 prompt 前，会有且只有一个候选被选中。`selected` 标记源码层面的默认候选；未标记时默认选择第一个候选。`empty` 表示这段 context slot 被有意省略。模型只看到被选中的 source，不会看到候选列表。

候选约束、trace 要求和优化器契约见 [`use one of ...`](./use-one-of.md)。

## Generate

`generate` 调用当前模型，需要 `input` 指令。返回 contract 是可选的。

```agentscript
answer = generate({
    input: "Answer using the selected context.",
    max_output: 800,
    attempts: 3,
    debug: true
}) -> {
    ok: boolean
    answer
    reason
}
```

### 语义

- `input`：每次生成的指令。必填。
- `max_output`：输出生成预算（数字或 `2k` 格式）。可选。
- `attempts`：JSON 解析失败或 contract 不匹配时的尝试次数。它是包含第一次调用在内的最大总尝试次数。可选，默认 1。
- `temperature`：provider sampling hint。可选。不支持的 provider hint 默认在 debug mode 下 warn，否则 ignore。
- `think`：provider/model reasoning hint。可选。不支持的 provider hint 默认在 debug mode 下 warn，否则 ignore。
- `strict`：控制 contract validation 是否严格。可选，默认 false。
- `debug`：将完整 prompt 打印到 stderr。可选，默认 false。
- 可选的 `-> { ... }` 块声明期望的输出 contract。
- 不写 `-> { ... }` 时，`generate` 输出无约束：AgentScript 不会在 prompt 中加入返回 schema，不会要求 provider 使用结构化输出，也不会对返回值做类型强制转换或 contract 校验。自由形式的 `generate` 是允许的，但不推荐用于 agent workflow。
- Provider 错误（认证、网络、超时、模型不存在）直接失败，不做重试。
- Contract 校验包含类型强制转换（如 `"true"` -> `true`，`"42"` -> `42`）。

Prompt 构造、identity、retry 和 trace 语义见 [`generate`](./generate.md)。

## 控制流

### If / else

```agentscript
if answer.ok and not input.dry_run {
    return answer
} else {
    return fallback(answer)
}
```

支持的运算符：`+`、`-`、`*`、`/`、`==`、`!=`、`<`、`<=`、`>`、`>=`、`and`、`or`、`not`。复合赋值支持 `+=` 和 `-=`。Context budget 和循环上限使用 `max`，因此 `<` 恢复为类似 `==` 的普通比较运算符。

### Loop until

```agentscript
done = false

loop until done max 6 {
    observation = observe(input)
    done = observation.ok
}
```

每轮开始时检查条件。条件为真或达到迭代上限时退出。

### Repeat

```agentscript
repeat * 3 {
    result = attempt(input)
    if result.ok {
        return result
    }
}
```

每次迭代创建子作用域。外层已有的变量被更新时跨迭代保留。迭代内新建的变量在每次结束后丢弃。

### For in

```agentscript
for step in plan.steps max 12 {
    result = Executor(step)
    results.add(result)
}
```

列表在循环开始时只求值一次。每次迭代创建子作用域。循环变量作用域限定在循环体内。

结构化并行 list 工作可写成表达式：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

`parallel for` 并发运行相互独立的 iteration，按输入顺序返回结果，并禁止共享可变外层状态。完整设计见 [`parallel for`](./parallel-for.md)。

## 列表和 JSON 辅助

```agentscript
first = items[0]
count = items.length
items.add(new_item)
summary = items.summary
```

- `list[index]` 只读。index 必须是非负整数。
- `list.add(value)` 修改原列表。恰好接受一个参数。
- `.length` 返回列表长度。
- `.summary` 返回列表的 JSON-safe 运行时视图。它不是 LLM 生成的摘要，也不是语义压缩；如果需要控制 prompt 大小，应通过 `use scratch.summary max 2k` 这类显式 context budget 裁剪。

## 工具

工具通过 URI scheme 导入，使用结构化 JSON 参数调用。

```agentscript
import tool Find from "sh://find"
import tool Grep from "sh://grep"
import tool File from "file://workspace"
import tool Env from "env://process"
import tool Http from "https://api.example.com"
import tool Search from "mcp://search"
```

### Find

```agentscript
files = Find.run({
    path: ".",
    name: "*.ts",
    type: "file",
    max: 50
})
```

### Grep

```agentscript
matches = Grep.run({
    path: "src",
    pattern: "TODO",
    include: "*.ts",
    max: 100
})
```

### ReadRange

```agentscript
lines = ReadRange.run({
    path: "src/main.as",
    start: 1,
    max: 20
})
```

### File

```agentscript
file = File.read({
    path: "README.md"
})
entries = File.list({
    path: "src"
})
result = File.write({
    path: "output.md",
    content: "# Result"
})
result = File.patch({
    path: "file.as",
    search: "old",
    replace: "new"
})
result = File.undo(effects)
```

Tool 成功结果统一是带 `ok: true` 的对象。`File.read` 返回 `content`，`File.list` 返回 `entries`，写和 patch 操作返回可撤销的 effect 记录。`File.undo` 接受 effect 记录列表并逆转。

### Env

```agentscript
home = Env.get({
    name: "HOME"
})
```

`Env.get` 返回 `{ ok: true, value }`；环境变量不存在时 `value` 为 `null`。

### Http

```agentscript
response = Http.get({
    url: "/api/data",
    headers: { Authorization: "Bearer ..." },
    timeout: 10000
})
response = Http.post({
    url: "/api/submit",
    body: { key: "value" },
    timeout: 10000
})
```

HTTP 请求限制在 import URI 的 origin 内。

HTTP 方法返回 `{ ok, status, body, json }`。`ok` 表示 HTTP status 是否为 2xx，`body` 是响应文本，`json` 是解析后的 JSON 值；响应体不是合法 JSON 时为 `null`。相对 URL 基于 import URI 解析，跨 origin 目标会被拒绝。对象类型 request body 会先转为 JSON-safe 值再序列化；服务端要求时需要显式设置 `content-type: application/json`。

### MCP

MCP 支持目前只覆盖 stdio transport。`mcp://name` 会解析到 workspace root
下 `agentscript.mcp.json` 中的 server entry。

```json
{
  "mcpServers": {
    "search": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server-search"]
    }
  }
}
```

Server `env` value 可以用 `$NAME` 片段引用宿主环境变量。不存在的变量展开为空字符串。`${NAME}` 和默认值语法不属于当前配置格式。

对于不是 AgentScript identifier 的 MCP tool name，使用 `call({ tool, args })`：

```agentscript
result = Search.call({
    tool: "web-search",
    args: {
        query: input.query
    }
})
```

如果 MCP tool name 本身是合法 identifier，也可以直接调用：

```agentscript
result = Search.search({
    query: input.query
})
```

MCP tool 返回值是普通数据，必须通过 `use` 显式选择后才会进入 prompt context。

### 安全

- 禁止通用 shell 入口（`sh://sh`、`sh://bash`、`sh://zsh`、`sh://fish`）。
- 文件路径限制在 workspace 根目录内。
- 逃逸 workspace 的符号链接不会被跟随。
- MCP tool 默认视为 effectful，不能在 `parallel for` 中调用。
- 写操作返回 effect 记录用于审计和撤销。

## Memory

Memory 提供跨运行的持久化、显式、可审计状态。

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import memory Runs from "sqlite://./.agentscript/memory.db#runs"
```

## 文件导入

文件导入将本地文件作为显式上下文资源加载。

```agentscript
import file Requirements from "./requirements.md"
import file Config from "./config.json"

agent Assistant {
    func answer(input) {
        use Requirements max 4k
        use Config
        generate({ input: "Answer from the referenced file." }) -> {
            ok: boolean
            answer
        }
    }
}
```

文本文件作为字符串加载。JSON 文件解析为 JSON 值。文件内容必须显式 `use` 才能进入 prompt context。

### API

```agentscript
Lessons.add({
    kind: "lesson",
    text: reflection.insight,
    goal: input.goal
})

past = Lessons.query({
    kind: "lesson",
    text: input.goal,
    limit: 5
})

use past max 2k
```

### 规则

- Memory 绑定不能直接用 `use` 作为 prompt context。
- 查询结果是普通数据，必须显式 `use`。
- `add` 接受一个对象参数。运行时自动补充 `id`、`created_at`、`updated_at`。
- `query` 支持 `text`（在 `record.text` 和 JSON-safe record view 上做大小写不敏感子串匹配）、`kind`（精确匹配）、`where`（精确字段匹配）和 `limit`。
- File memory 使用 JSONL 格式，文件和父目录自动创建。
- SQLite memory 使用固定 schema，不暴露任意 SQL。

## Agent 组合

多 Agent 组合通过 import、函数调用和显式参数传递实现。

```agentscript
import agent Planner from "./planner.as"
import agent Executor from "./executor.as"

main agent Controller {
    main func(input) {
        plan = Planner(input)
        results = []
        for step in plan.steps max 10 {
            result = Executor({
                goal: input.goal,
                step: step
            })
            results.add(result)
        }
        results.summary
    }
}
```

每个 Agent 调用创建独立作用域。上下文边界永远不会隐式跨越。Trace 事件嵌套记录。

## 保留词

`import`、`from`、`main`、`agent`、`func`、`use`、`as`、`max`、`loop`、`until`、`repeat`、`for`、`in`、`return`、`if`、`else`、`and`、`or`、`not`、`generate`、`true`、`false`、`none`、`string`、`number`、`boolean`、`json`、`list`。

以下不是保留词：`input`、`act`、`reason`、`observe`、`reflect`、`answer`、`scratch`、`done`、`task`、`output`、`context`、`repair`。

## 执行模型

```text
源码 -> tokenizer -> parser -> AST -> semantic analyzer -> interpreter -> trace + result
```

解释器是树遍历求值器。无 IR、字节码或编译步骤。

## 模块

| 模块 | 路径 | 职责 |
|------|------|------|
| Tokenizer | `src/parser/tokenizer.ts` | 词法分析 |
| Parser | `src/parser/parser.ts` | 递归下降解析 |
| Semantic analyzer | `src/semantic/analyzer.ts` | 静态语义检查 |
| Interpreter | `src/runtime/interpreter.ts` | 入口、Agent/函数调用 |
| Evaluator | `src/runtime/evaluator.ts` | 表达式求值、工具调度、use 解析 |
| Generator | `src/runtime/generate.ts` | Generate 执行、修复、context 构建 |
| Scope | `src/runtime/scope.ts` | 变量作用域、配置、use 声明 |
| Context builder | `src/runtime/context.ts` | Prompt 构建、裁剪 |
| LLM provider | `src/providers/llm/` | OpenAI、Anthropic、Ollama |
| Memory provider | `src/providers/memory/` | File JSONL、SQLite |
| Tool provider | `src/providers/tools/` | 宿主工具实现 |
| CLI | `src/bin/agentscript.ts` | 命令行接口 |
| REPL | `src/bin/repl.ts` | 交互式 REPL |

## 非目标

AgentScript v0.1.x 不包含：

- 通用工作流引擎。
- 通用并行执行语法。
- 通用事务或自动回滚。
- 任意 SQL 执行。
- 自动长期记忆。
- 自动捕获局部变量到 prompt。
- 自动修改 `.as` 源码。
- 完整静态类型系统。
