# AgentScript V1 Design

V1 的目标不是把 AgentScript 扩展成通用工作流语言，而是在 V0 的小语言面上支持更多常见 Agent 模式。设计原则仍然是少关键词、强作用域、显式上下文。

V1 应优先增强普通数据、Agent 组合、工具能力和文件组织，而不是增加 `planner`、`executor`、`verifier`、`rollback`、`parallel` 这类模式专用关键词。

`use`、作用域和 prompt context 的基础语义见 [`Context Engineering`](../cn/context-engineering.md)。V1 的新能力必须保持这些核心语义，不应把 AgentScript 误扩展成会隐式捕获上下文的通用编程语言。

## 目标

V1 支持的核心模式：

- ReAct：V0 已支持，V1 保持兼容。
- Plan-and-Execute：生成结构化计划，逐步执行，校验并按需重规划。
- Reflection / Self-improve：用短 insight 改进下一次尝试。
- Evaluator-Optimizer：生成候选结果，由 evaluator 校验，再改进。
- Multi-agent composition：不同 Agent 拆分职责，调用边界天然隔离上下文。

V1 不追求：

- 通用事务系统。
- 通用并行编排。
- Durable workflow。
- 完整类型系统。
- 内建 eval/harness DSL。
- 默认自动 repair。

## 语言面收紧

V1 尽量不新增模式关键词。

继续保持：

- `planner`、`executor`、`verifier`、`controller` 都是普通 Agent 或普通函数名。
- `plan`、`step`、`status`、`result` 都是普通 JSON/list 数据。
- `rollback` 不作为关键词。
- `parallel` 不作为 V1 核心关键词。

V1 可考虑新增的语言能力只有两类：

- 更自然的 list 遍历。
- 跨文件 import。

## Plan-and-Execute

Plan-and-Execute 可以用普通 Agent 表达：

```agentscript
import agent Planner  from "./planner.as"
import agent Executor from "./executor.as"
import agent Verifier from "./verifier.as"

main agent PlanAndExecute {
    main func(input {
        goal string
    }) {
        plan = Planner(input)
        results = []

        for step in plan.steps < 12 {
            result = Executor({
                goal: input.goal
                step: step
                previous: results.summary
            })

            verdict = Verifier({
                goal: input.goal
                step: step
                result: result
            })

            if verdict.ok {
                results.add({
                    step: step.id
                    result: result
                })
            } else {
                plan = Planner({
                    goal: input.goal
                    previous: results.summary
                    problem: verdict.reason
                })
            }
        }

        return {
            ok: true
            results: results
        }
    }
}
```

这里新增的核心语法只有：

```agentscript
for item in list < n {
    ...
}
```

规则：

- `for` 每次迭代创建子作用域。
- `< n` 是硬上限。
- list 在循环开始时求值一次。
- 循环体内新建变量不会泄漏到外层。
- 外层已存在变量可以被更新，例如 `results.add(...)` 或 `plan = ...`。

## Plan 数据约定

V1 不需要专门的 `plan` 类型。推荐结构：

```agentscript
return generate({ input: "Create a short executable plan" }) {
    return {
        steps list[json]
    }
}
```

每个 step 推荐包含：

```json
{
  "id": "step-1",
  "task": "Search for current docs",
  "kind": "search",
  "status": "pending"
}
```

`kind`、`status` 只是字符串，不需要枚举类型。

## 回滚与补偿

V1 不引入 `rollback` 关键词。

原因：Agent 的副作用通常来自工具，例如写文件、执行 shell、调用 API。语言层无法保证这些副作用都能严格回滚。V1 采用 effect record + compensation 的设计。

有副作用的工具应返回 effect 信息：

```json
{
  "ok": true,
  "value": "...",
  "effects": [
    {
      "id": "effect-123",
      "tool": "File",
      "undoable": true
    }
  ]
}
```

Agent 用普通函数处理补偿：

```agentscript
func compensate(result) {
    if result.effects {
        return File.undo(result.effects)
    }

    return {
        ok: true
    }
}
```

Controller 逻辑也用普通函数表达：

```agentscript
if not verdict.ok {
    compensate(result)
    plan = revise(goal, plan, results, verdict)
}
```

这不是严格事务，而是可审计的补偿动作。

## 并行

V1 核心不引入并行语法。

原因：

- 并行会影响 trace 顺序。
- 并行会放大工具副作用风险。
- 并行需要 rate limit、错误聚合和预算控制。
- 当前 V0/V1 的作用域模型以顺序执行为基础，容易审计。

V1 可以在 runtime 实验层支持并行工具或并行 Agent 调用，但不进入核心语法。正式并行语法应等 Plan-and-Execute 顺序模型稳定后再设计。

## Tool URI Scheme

V1 的 `import tool` 不应绑定到单一协议。MCP 可以作为一种工具来源，但 shell/io/http 这类常见能力不需要强行放进 `mcp://...`。

推荐规则：

- `mcp://...` 表示外部 MCP 工具。
- `sh://...` 表示 host runtime 提供的具体 shell 命令。
- `file://...` 表示 host runtime 提供的文件能力。
- `env://...` 表示 host runtime 提供的环境变量读取能力。
- `http://...` / `https://...` 表示 HTTP 工具或远端服务。
- 自定义 runtime 可以注册更多 scheme。

URI scheme 只决定绑定到哪个 provider；具体方法仍通过普通成员调用表达。

## 常用 Shell / IO 工具

V1 可以定义一组推荐 host tools，而不是把 shell/io 做成语言关键词，也不要求它们经过 MCP。

推荐工具 import：

```agentscript
import tool Find from "sh://find"
import tool Grep from "sh://grep"
import tool Sed  from "sh://sed"
import tool File from "file://workspace"
import tool Env  from "env://process"
import tool Http from "https://api.example.com"
```

推荐能力：

- `Find.run({ path, name, type, max })`
- `Grep.run({ path, pattern, include, max })`
- `Sed.run({ path, start, max })`
- `File.read({ path })`
- `File.write({ path, content })`
- `File.patch({ path, search, replace })`
- `File.list({ path })`
- `File.undo(effects)`
- `Env.get({ name })`
- `Http.get({ url, headers })`
- `Http.post({ url, headers, body })`

示例：

```agentscript
files = Find.run({
    path: "."
    name: "*.ts"
    max: 50
})

matches = Grep.run({
    path: "src"
    pattern: "generate"
    include: "*.ts"
    max: 100
})
```

安全规则应由 host runtime 执行：

- `sh://...` 工具必须绑定到具体命令。
- 禁止 `sh://sh`、`sh://bash`、`sh://zsh`、`sh://fish` 这类通用 shell。
- 禁止通过 `sh://...` 传入任意命令字符串；参数必须是结构化字段。
- shell 工具默认需要工作目录、超时和输出上限。
- 文件工具默认限制在 workspace 内。
- 写文件工具必须返回 effect record。
- 网络工具可由 host 配置允许或禁止。

## 文件引用

V1 增加文件资源 import：

```agentscript
import file Requirements from "./requirements.md"
import file ApiSpec      from "./openapi.json"
```

文件资源是只读上下文资源。使用方式：

```agentscript
func answer(input) {
    use Requirements < 4k
    use input.question

    return generate({ input: "Answer from the referenced file" }) {
        return {
            ok boolean
            text string
        }
    }
}
```

规则：

- `file` 只在 `import file` 中作为资源类别。
- 文件内容默认不进入 prompt，必须 `use`。
- `use Requirements < 4k` 应用上下文预算。
- JSON 文件可以作为 json 读取；文本文件作为 string 读取。
- 文件路径相对当前 `.as` 文件解析。

## 跨文件 Agent Import

V1 增加 Agent import：

```agentscript
import agent Planner  from "./agents/planner.as"
import agent Executor from "./agents/executor.as"
import agent Verifier from "./agents/verifier.as"
```

规则：

- 被 import 的文件可以包含一个或多个 Agent。
- `import agent Name from "./x.as"` 导入文件中名为 `Name` 的 Agent。
- 导入的 Agent 不自动成为入口。
- 当前程序仍然只能有一个 `main agent`。
- `Planner(input)` 调用 `Planner` 的 `main func`。
- `Planner.make(input)` 调用指定函数 `make`。
- 跨文件 Agent 调用保持独立函数作用域和嵌套 trace。

开放问题：

- 是否允许 `import agent * from "./agents.as"`。V1 初期建议不支持。
- 是否允许 import alias。可用 `import agent Planner as PlanMaker from ...`，但这会增加语法，V1 初期建议不支持。
