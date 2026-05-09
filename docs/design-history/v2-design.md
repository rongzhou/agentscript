# AgentScript V2 Design

V2 的目标是引入可持久化、可审计、显式使用的 Agent Memory，使 reflection、self-improvement 和更谨慎的 self-evolution 模式可以用普通 AgentScript 组合出来。

V2 不把 `reflect`、`improve`、`evolve` 做成关键词。它们应继续是普通函数名、Agent 名或业务模式。语言层面只提供必要的 memory 原语。

`use`、作用域和 prompt context 的基础语义见 [`Context Engineering`](../cn/context-engineering.md)。Memory 必须遵守同一原则：memory 不会自动进入 prompt，只有查询结果被赋值为普通数据并显式 `use` 后，才会进入后续 `generate`。

## 目标

V2 支持的核心能力：

- `import memory` 声明外部记忆体。
- file JSONL memory backend。
- sqlite memory backend。
- 最小 memory 操作：`add` 和 `query`。
- memory 操作写入 trace，便于审计。
- reflection / self-improvement 通过普通 Agent、函数和 memory 组合表达。

V2 不追求：

- 向量数据库。
- 任意 SQL 执行。
- 自动长期记忆。
- 自动记录所有 trace 到 memory。
- 自动修改 `.as` 源码。
- 通用 eval/harness DSL。
- 通用事务、回滚或并行 workflow。

## Memory 定位

Memory 是跨运行持久化的上下文资产。

它不同于 tool：

- tool 表示外部动作能力。
- memory 表示可读写的持久化数据源。

它也不同于 file import：

- file import 是静态或半静态输入。
- memory 会被 AgentScript 显式写入，并影响未来运行。

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import memory Runs    from "sqlite://./.agentscript/memory.db#runs"
```

Memory binding 是 runtime capability，不能直接进入 prompt：

```agentscript
use Lessons // invalid
```

必须先查询，得到普通 JSON/list 数据：

```agentscript
past = Lessons.query({
    text: input.goal
    limit: 5
})

use past < 2k
```

## 最小 API

V2 memory 先只定义两个操作。

### add

```agentscript
Lessons.add({
    kind: "lesson"
    text: reflection.insight
    goal: input.goal
    ok: result.ok
})
```

语义：

- 追加一条记录。
- 参数必须是 JSON object。
- runtime 自动补充 `id`、`created_at` 和 `updated_at`。
- 返回写入后的记录 envelope。
- 写入 trace，但不自动进入 prompt。

推荐返回结构：

```json
{
  "id": "...",
  "created_at": "...",
  "updated_at": "...",
  "record": {
    "kind": "lesson",
    "text": "...",
    "goal": "..."
  }
}
```

### query

```agentscript
past = Lessons.query({
    text: input.goal
    kind: "lesson"
    limit: 5
})
```

语义：

- 返回 list。
- `limit` 可选，缺省值由 runtime 设定。
- `text` 可选，表示文本相关查询。
- `kind` 可选，表示记录类型过滤。
- `where` 可选，表示顶层字段精确匹配。
- 结果默认按最近写入优先。

推荐查询参数：

```agentscript
{
    text: string
    kind: string
    where: json
    limit: number
}
```

V2 的 `text` 查询不承诺语义向量检索。file backend 可以先做大小写不敏感字符串匹配；sqlite backend 可以先做 `LIKE`，之后再升级 FTS5。

## File Memory

file memory 使用 JSONL：

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
```

每一行是一条 envelope：

```json
{"id":"...","created_at":"...","updated_at":"...","record":{"kind":"lesson","text":"..."}}
```

规则：

- 文件不存在时可自动创建。
- 父目录不存在时可自动创建。
- 每次 `add` 追加一行 JSON。
- `query` 读取文件并过滤。
- 损坏 JSONL 行应报错，不静默跳过。
- 相对路径基于入口 `.as` 文件目录解析；REPL 中基于当前工作目录。

file memory 的价值是透明、易调试、适合早期 self-improvement。

## SQLite Memory

sqlite memory 使用固定 schema：

```agentscript
import memory Lessons from "sqlite://./.agentscript/memory.db#lessons"
```

URI 语义：

- path 指向 sqlite 数据库文件。
- fragment 指向 memory namespace 或 table 名。
- fragment 为空时使用默认 namespace `memory`。

推荐 schema：

```sql
CREATE TABLE IF NOT EXISTS memory_records (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT,
  text TEXT,
  record_json TEXT NOT NULL,
  PRIMARY KEY (namespace, id)
);
```

实现规则：

- AgentScript 不暴露任意 SQL。
- `add(record)` 写入 `record_json`，并从 record 顶层提取 `kind` 和 `text`。
- `query({ kind, text, where, limit })` 在固定 schema 上查询。
- `where` 只做 record 顶层字段精确匹配。
- 第一版可以用 `LIKE` 做 text 查询；FTS5 可作为后续增强。

SQLite backend 的价值是稳定、可扩展、适合长期运行。

## Reflection 模式

Reflection 不需要新关键词。

```agentscript
agent Reflector {
    model Qwen
    role "Reflector"
    description "Extract reusable lessons from execution results."

    main func(input) {
        use input

        generate({
            input: "Extract one reusable lesson from this run.",
            attempts: 3
        }) -> {
            insight string
            mistake string
            next_rule string
        }
    }
}
```

调用方决定是否写入 memory：

```agentscript
reflection = Reflector({
    goal: input.goal
    result: result
})

Lessons.add({
    kind: "lesson"
    text: reflection.insight
    goal: input.goal
    next_rule: reflection.next_rule
})
```

## Self-Improvement 模式

Self-improvement 的 V2 定义是：

> Agent 显式读取过去 lesson，把相关 lesson 放入当前 prompt，并在运行结束后显式写入新的 lesson。

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import memory Lessons from "file://./.agentscript/lessons.jsonl"

main agent Learner {
    model Qwen
    role "Learning Agent"
    description "Use durable lessons to improve future answers."

    main func(input {
        goal string
    }) {
        past = Lessons.query({
            text: input.goal
            kind: "lesson"
            limit: 5
        })

        use input.goal
        use past < 2k

        result = generate({
            input: "Answer the goal using relevant past lessons.",
            attempts: 3
        }) -> {
            ok boolean
            answer string
            reason string
        }

        reflection = reflect({
            goal: input.goal
            result: result
        })

        Lessons.add({
            kind: "lesson"
            text: reflection.insight
            goal: input.goal
            ok: result.ok
        })

        result
    }

    func reflect(run) {
        use run

        generate({
            input: "Extract one reusable lesson from this run.",
            attempts: 3
        }) -> {
            insight string
        }
    }
}
```

这里的改进来自 memory，而不是隐式上下文膨胀。

## Self-Evolution 边界

V2 只支持保守的 self-evolution：

- 生成 rule、preference、lesson、profile 等可持久化数据。
- 下一次运行通过 memory 查询和 `use` 显式影响行为。
- 可以生成 patch proposal，但不自动修改源代码。

V2 不支持：

- Agent 自动改写自己的 `.as` 文件。
- 自动安装工具或依赖。
- 自动改变 import URI。
- 绕过 host 授权写入任意路径。

原因：

- 代码自修改需要更强的权限模型、审计和回滚。
- memory 更新已经足够覆盖大多数 self-improvement 场景。
- AgentScript 的核心仍是 context engineering，而不是 autonomous code mutation。

## Trace

Memory 操作必须写入 trace：

```json
{
  "kind": "memory",
  "data": {
    "memory": "Lessons",
    "operation": "query",
    "uri": "file://./.agentscript/lessons.jsonl",
    "args": { "kind": "lesson", "limit": 5 },
    "count": 3
  }
}
```

写入 trace：

```json
{
  "kind": "memory",
  "data": {
    "memory": "Lessons",
    "operation": "add",
    "id": "...",
    "record": { "kind": "lesson", "text": "..." }
  }
}
```

trace 是审计产物，不会自动进入 prompt。

## 安全边界

V2 memory 需要 host runtime 控制：

- file/sqlite 路径必须限制在 workspace 或明确授权目录内。
- `file://` memory 只能写 JSONL。
- `sqlite://` memory 只能操作固定 schema。
- 不支持 `sqlite://...` 任意 SQL。
- memory binding 不能被 `use`。
- memory 查询结果是普通数据，可以被 `use`。

## 与 V1 的关系

V1 的 Plan-and-Execute、Evaluator-Optimizer 和 Multi-agent composition 可以直接叠加 V2 memory：

- Planner 查询过去 plan 失败经验。
- Executor 查询工具调用注意事项。
- Verifier 写入失败样本。
- Controller 写入 run summary。

V2 不改变 V1 控制流，也不增加模式专用关键词。
