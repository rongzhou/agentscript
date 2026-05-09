# AgentScript V0 Design

AgentScript 是一种用于构建 LLM Agent 的小型领域语言。V0 的目标是用最小语言面实现一个可运行、可审计、能管理上下文边界的 ReAct Agent。长期能力可以继续扩展，但 V0 只描述当前已经实现和测试覆盖的行为。

核心原则：

- Agent 是执行和 prompt 身份的基本单元。
- 所有函数必须定义在 `agent` 内；V0 没有全局函数。
- `{}` 作用域决定变量、`use` 上下文和 repeat 临时状态的生命周期。
- 未被 `use` 的普通变量不会进入 LLM prompt。
- trace 是调试和审计产物，不会自动进入 prompt。
- 关键词保持少量；能由作用域和普通变量表达的能力不增加专用关键词。

## 最小能力

V0 支持：

- `import llm` 和 `import tool` 资源声明。
- `main agent` 和 `main func` 显式入口。
- Agent 内函数、变量赋值、对象/列表字面量、成员访问、函数调用。
- `model`、`role`、`description` 作用域配置。
- `use` 上下文声明和 `< n` 上下文预算。
- `generate({ input, limit, attempts, debug }) -> { ... }` LLM 调用。
- `if` / `else`，`==`、`!=`、`and`、`or`、`not`。
- `loop until condition < n` 有上限循环。
- `repeat * n` 有上限重复执行。
- 入口 input shape 和交互式补齐。
- 跨 Agent 调用：`Worker.run(input)`；`Worker(input)` 调用 `Worker` 的 `main func`。

V0 不支持：

- 全局函数。
- 用户自定义类型、类、继承、泛型。
- 通用异步、并发、事务或回滚。
- `context {}`、`include`、`exclude`、`retain`、`isolate` 等上下文关键词。
- RAG、长期 memory、harness/eval 编排。
- 通用异常捕获、事务或回滚。

## 程序入口

程序从 `main agent` 的 `main func` 启动。

```agentscript
main agent ResearchAgent {
    model Qwen
    role "Researcher"
    description "Research with search observations."

    main func(input {
        question string
    }) {
        use input.question
        answer(input.question)
    }

    func answer(question) {
        use question

        generate({ input: "Answer the question" }) -> {
            ok boolean
            text string
        }
    }
}
```

入口规则：

- 一个程序最多一个 `main agent`。
- 一个 Agent 最多一个 `main func`。
- 多 Agent 程序必须声明 `main agent`。
- `main agent { ... }` 可以省略 Agent 名，内部名为 `__main_agent`。
- `main func(input) { ... }` 可以省略函数名，内部名为 `__main`。
- `input` 不是关键词，只是入口参数的常用约定。
- 只有 `main func` 的第一个 `input` 参数可以声明 shape。

## 资源

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Search from "mcp://tools/search"
```

LLM URI：

- `openai://gpt-4.1-mini`，需要 `OPENAI_API_KEY`。
- `anthropic://claude-sonnet-4-0`，需要 `ANTHROPIC_API_KEY`。
- `ollama://localhost:11434/qwen3.6`，显式 Ollama 地址。

工具由 host runtime 提供。工具调用输出会写入 trace，但不会自动进入后续 prompt。

## 作用域配置

`model`、`role`、`description` 是作用域配置。函数或块内可以覆盖父作用域配置。

```agentscript
agent A {
    model Fast
    role "Assistant"
    description "Default behavior."

    func careful(input) {
        model Strong
        description "Use a stronger model for this function."

        generate({ input: "Answer carefully" }) -> {
            text string
        }
    }
}
```

规则：

- `model` 必须引用 `import llm` 名称。
- `role` 和 `description` 必须是字符串。
- 执行 `generate` 时，当前作用域必须能解析到 `model`、`role`、`description`。
- 不调用 `generate` 的纯工具或纯计算函数不需要这些配置。

## 数据和 Shape

V0 运行时数据以 JSON 为核心：

- `string`
- `number`
- `boolean`
- `json`
- `list`

`generate` 返回 shape 使用轻量标注：

```agentscript
generate({ input: "Extract facts" }) -> {
    facts list[string]
    source string
    meta json
    ok boolean
}
```

Shape 只用于入口 input 校验和 `generate` 输出校验，不是完整类型系统。

## 上下文

`use` 表示一个值允许进入当前作用域后续 `generate` 的 prompt context。

```agentscript
func compose(question, scratch) {
    use question
    use scratch.summary < 2k

    generate({ input: "Answer using only the context" }) -> {
        ok boolean
        text string
    }
}
```

规则：

- `use` 只能写在函数或执行块内。
- `use` 只能引用当前可见的普通运行时值。
- `llm`、`tool`、`agent` 资源绑定不能被 `use`。
- 子作用域继承父作用域的 `use`。
- `use value < n` 对该上下文项应用预算；`2k` 约等于 2000 字符。
- 未被 `use` 的变量、工具原始输出和 trace 不进入 prompt。

## Generate

`generate({ input, limit, attempts, debug }) -> { ... }` 表示一次 LLM call。`input` 是本次 call 的最后用户指令，可以是字符串、对象或其它 JSON 值。`limit`、`attempts`、`debug` 都是可选参数。

```agentscript
answer = generate({
    input: "Answer using collected facts"
    limit: 800
    attempts: 3
}) -> {
    ok boolean
    text string
    error string
}
```

规则：

- `generate` 是语法级内置表达式，不是普通函数。
- `generate` 参数必须是对象，且必须包含 `input` 字段。
- `limit` 是本次 LLM call 的预算，支持 `800` 或 `2k` 这类 budget 字面量。
- `attempts` 表示最多生成次数；它不是额外重试次数。
- `debug` 是 boolean，缺省值为 `false`；为 `true` 时 runtime 将完整 prompt 打印到 stderr。
- `-> { ... }` 描述 LLM 输出 JSON shape，不会从外层函数返回。
- LLM 输出会先按 shape 做有限容错转换。
- 当输出不是 JSON 或转换后仍不符合 shape，且 `attempts > 1` 时，下一次调用会把上一次输出和错误信息附加到 `input` 后，请模型 repair。
- provider 网络、认证、超时、模型不存在等基础设施错误不会被 repair 重试。

## 控制流

### If

```agentscript
if answer.ok and not input.dry_run {
    return answer
} else {
    return failed(answer.error)
}
```

V0 条件表达式只支持：

- `==`
- `!=`
- `and`
- `or`
- `not`

`<` 不作为通用比较运算符；它只用于预算和循环上限。

### Loop

```agentscript
done = false

loop until done < 6 {
    observation = observe(Search.search(query))
    scratch.add(observation)
    done = enough_evidence(scratch)
}
```

`loop until condition < n` 每轮开始先检查 `condition`。当条件为真或达到 `n` 次上限时结束。

### Repeat

```agentscript
insight = none

repeat * 3 {
    scratch = []
    answer = attempt(input.question, insight)

    if answer.ok {
        return answer
    }

    insight = reflect(answer.error, scratch.summary)
}
```

规则：

- 每次 repeat attempt 创建新的子作用域。
- repeat 块内新建变量在本次 attempt 结束后丢弃。
- repeat 外层已存在的变量在块内被赋值时会更新外层变量。
- 这允许保留短 `insight`，同时丢弃完整尝试过程。

## Agent 调用

```agentscript
result = Worker.run(input)
result = Worker(input)
```

规则：

- `Worker.run(input)` 调用 `Worker` 的 `run` 函数。
- `Worker(input)` 调用 `Worker` 的 `main func`。
- 跨 Agent 调用使用独立函数作用域；子 Agent 内部 trace 嵌套在顶层 `agent` trace 事件下。

## CLI

开发期命令：

```bash
npm run agentscript -- tutorials/react.as --input '{"question":"What is AgentScript?"}'
npm run agentscript -- tutorials/react.as --check
npm run agentscript -- tutorials/react.as --parse
npm run agentscript
```

构建后：

```bash
node dist/bin/agentscript.js tutorials/react.as --input '{"question":"What is AgentScript?"}'
node dist/bin/agentscript.js
```

选项：

- `--input '<json>'`
- `--input-file input.json`
- `--agent AgentName`
- `--function functionName`
- `--check`
- `--parse`
- `--real-llm`
- `--trace trace.json`
- `--trace pretty`
- `--verbose`
- `--quiet`

无参数启动进入 REPL。REPL 以一个完整 `agent` 声明为最小粘贴单元。

```text
> :import llm Qwen from "ollama://localhost:11434/qwen3.6"
> :load tutorials/helloworld.as
> :check
> :run {}
> :trace pretty
> :exit
```

## 保留词

V0 保留词：

- `import`
- `from`
- `main`
- `agent`
- `func`
- `use`
- `loop`
- `until`
- `repeat`
- `for`
- `in`
- `return`
- `if`
- `else`
- `and`
- `or`
- `not`
- `generate`
- `true`
- `false`
- `none`
- `string`
- `boolean`
- `json`
- `list`

以下不是关键词：`input`、`act`、`reason`、`observe`、`reflect`、`answer`、`scratch`、`done`、`task`、`output`、`context`、`include`、`exclude`、`retain`、`isolate`、`repair`。

`act` 只是普通函数名，没有入口或 Agent 调用约定。

## 示例

完整示例在：

- `tutorials/helloworld.as`
- `tutorials/react.as`
- `tutorials/cli.as`
- `examples/review.as`
- `examples/summarize.as`
- `examples/changelog.as`
