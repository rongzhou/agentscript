# AgentScript V0 Implement

本文档是 V0 阶段的历史实现快照。语言设计见 `v0-design.md`。当前 v0.1.x 的实现入口和模块概览见 `../en/language.md` 与 `../cn/language.md`。

## 执行管线

V0 采用解释执行：

```text
source
  -> tokenizer
  -> parser
  -> AST
  -> semantic analyzer
  -> interpreter
  -> trace + result
```

V0 不实现 IR、字节码或编译到其他 runtime。当前语言面很小，解释器足够验证作用域、`use`、`generate`、工具调用、`repeat` 和 trace 行为。

## 模块

V0 阶段的核心源码模块：

- `src/parser/tokenizer.ts`：分词。
- `src/parser/parser.ts`：递归下降 parser，输出 AST。
- `src/ast/types.ts`：AST 类型。
- `src/semantic/analyzer.ts`：静态语义检查。
- `src/runtime/interpreter.ts`：解释器入口、Agent/函数调用和语句执行。
- `src/runtime/evaluator.ts`：表达式求值、工具调用和 `use` source 解析。
- `src/runtime/generate.ts`：`generate` 执行、上下文构建调用、LLM 调用和输出校验。
- `src/runtime/scope.ts`：运行时变量、配置和 `use` 作用域。
- `src/runtime/context.ts`：`generate` prompt/context builder。
- `src/providers/llm/`：OpenAI、Anthropic、Ollama provider。
- `src/runtime/types.ts`：运行时值、provider 接口和执行选项类型。
- `src/runtime/guards.ts`：运行时值类型守卫。
- `src/runtime/json.ts`：JSON 解析和序列化工具。
- `src/runtime/truth.ts`：条件表达式 truthiness。
- `src/runtime/shape.ts`：shape 构建、校验和 `generate` 输出容错转换。
- `src/providers/mock/index.ts`：mock LLM/tool provider。
- `src/runtime/trace.ts`：trace 格式化。
- `src/bin/agentscript.ts`：CLI。
- `src/bin/repl.ts`：agent-level REPL。

后续 V1/V2 继续增加了 loader、memory、tools、输入处理、诊断和包入口等模块。当前代码库中与实现相关的主要补充模块包括：

- `src/index.ts`：包入口。
- `src/ast/format.ts`：AST 表达式源码格式化。
- `src/parser/errors.ts`：解析错误类型。
- `src/semantic/diagnostics.ts`：语义诊断格式化。
- `src/runtime/errors.ts`：运行时错误类型。
- `src/runtime/input.ts`：入口输入 shape 处理。
- `src/runtime/loader.ts`：跨文件 import 加载器。
- `src/providers/memory/`：File JSONL 和 SQLite memory provider。
- `src/providers/tools/`：host tool provider 实现。
- `src/bin/input.ts`：CLI 输入解析。

## AST 范围

V0 AST 节点：

- `Program`
- `ImportDecl`
- `AgentDecl`
- `ConfigDecl`
- `ConfigStmt`
- `FuncDecl`
- `FuncParam`
- `UseStmt`
- `AssignStmt`
- `ExprStmt`
- `IfStmt`
- `LoopUntilStmt`
- `RepeatStmt`
- `ReturnStmt`
- `IdentifierExpr`
- `StringExpr`
- `NumberExpr`
- `BooleanExpr`
- `NullExpr`
- `ListExpr`
- `ObjectExpr`
- `ShapeObjectExpr`
- `MemberExpr`
- `CallExpr`
- `UnaryExpr`
- `BinaryExpr`
- `GenerateExpr`

重要解析规则：

- `main agent { ... }` 映射为匿名入口 Agent，内部名 `__main_agent`。
- `main func(input) { ... }` 映射为匿名入口函数，内部名 `__main`。
- `AgentName(input)` 是普通 `CallExpr`，语义和运行时把它解析为目标 Agent 的 `main func` 调用。
- `generate({ input: "...", limit: 500 }) -> { ... }` 把生成预算保存在 `GenerateExpr` options 中。
- `use value < 2k` 的预算在 `UseStmt` 上。
- `loop until done < 6` 的 `< 6` 是循环上限，不是比较表达式。

## 语义检查

当前 semantic analyzer 检查：

- import 名称重复。
- agent 名称重复。
- 多 Agent 程序必须有一个 `main agent`。
- `main agent`、`main func` 不能重复。
- 入口 Agent 必须有 main func；单 Agent 程序省略 `main agent` 时，该 Agent 仍必须有 main func。
- 同一 Agent 内函数名不能重复。
- 参数名不能重复。
- 只有 `main func` 的第一个 `input` 参数可以声明 shape。
- `model` 必须引用 `import llm`。
- `role`、`description` 必须是字符串。
- 标识符必须在当前词法作用域中可见。
- `use` 不能引用 `llm`、`tool`、`agent`、`memory` 资源绑定。
- 赋值目标只能是标识符或成员表达式。
- 函数调用参数数量必须匹配。
- `AgentName(input)` 要求目标 Agent 有 `main func`。
- `Worker.run(input)` 要求目标 Agent 有对应函数。
- `generate` 参数必须是对象字面量，包含 `input` 字段；`limit`、`attempts`、`debug` 可选，其中 `attempts` 必须是正整数，`debug` 必须是 boolean。
- shape 字段不能重复，类型只能是 `string`、`number`、`boolean`、`json`、`list` 或 `list[...]`。
- `< n` budget 在 `use` 中必须大于 0。

## 运行时语义

解释器行为：

- 入口选择：优先 `main agent` 和 `main func`；单 Agent 程序可省略 `main agent`。
- 函数调用创建新的运行时作用域。
- 子作用域可读父作用域变量。
- 赋值给已存在的父作用域变量会更新父作用域。
- 赋值给不存在的名字会在当前作用域创建局部变量。
- 局部变量可以遮蔽 import、agent、function 绑定。
- `if`、`loop`、每次 `repeat` attempt 都创建子作用域。
- `repeat` 外层变量可以跨 attempt 保留；attempt 内新建变量不会跨 attempt 保留。
- `use` 声明随作用域继承。
- 入口 shape 缺失字段由 `InputProvider` 补齐；非交互环境没有 provider 时抛错。

## Context Builder

`src/runtime/context.ts` 只在执行 `generate` 时工作。

输入：

- 当前 Agent 名称。
- 当前作用域 `model`、`role`、`description`。
- 当前可见 `use` 列表。
- `generate({ input, limit, attempts, debug })` 中的 `input` instruction。
- `generate` 返回 shape。
- 可选 `limit` 预算。

输出：

- system prompt。
- context 项列表。
- JSON schema。
- final user message。

V0 的预算裁剪按字符数实现：`2k` 约等于 2000 字符。这是当前实现行为，不代表 tokenizer-aware 预算。

裁剪是结构感知的：

- string 按字符截断。
- list 保留完整 item，从尾部移除。
- object 保留完整字段，从尾部移除。
- trace 中记录每个 context item 的 `originalSize` 和 `clippedSize`。

## LLM Provider

`ProtocolLlmProvider` 支持：

- OpenAI Chat Completions structured output。
- Anthropic Messages。
- Ollama `/api/chat`。

配置：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `OLLAMA_BASE_URL`
- `AGENTSCRIPT_LLM_TIMEOUT_MS`

输出处理：

- provider HTTP 响应必须是 JSON。
- 模型内容必须能解析为 JSON，允许从 fenced JSON 或文本中的 `{...}` 提取。
- 解析后的值会先按 `generate` shape 做有限容错转换。
- `limit` 是可选 provider token limit。
- `attempts` 缺省值为 `1`。
- `debug` 缺省值为 `false`；为 `true` 时完整 prompt 打印到 stderr。
- JSON 解析失败或 shape 不匹配时，如果还有剩余 attempts，会把上一次错误和可用的上一次输出附加到下一次 `generate` 的 instruction。
- provider 网络、认证、超时、模型不存在等基础设施错误直接抛出，不做 repair 重试。

## Tool Provider

工具通过 `ToolProvider` 接口接入：

```ts
interface ToolProvider {
    call(request: ToolCallRequest): Promise<RuntimeValue>;
}
```

mock tool provider 返回包含工具名、URI 和参数的 JSON，便于测试 trace 和上下文边界。

## Trace

V0 trace 事件：

- `input`
- `use`
- `generate`
- `tool`
- `agent`

跨 Agent 调用的内部事件嵌套在 `agent.data.trace` 下。顶层 trace 因此保留调用边界，不把子 Agent 的 `use`、`generate`、`tool` 事件平铺到父 Agent trace。

CLI 支持：

- 默认 JSON 输出携带 trace。
- `--trace trace.json` 写入 trace 文件。
- `--trace pretty` 追加可读 trace。
- `--verbose` 追加可读 trace。
- `--quiet` 只输出最终 value。

REPL 支持：

- `:trace`
- `:trace pretty`

## CLI 和 REPL

CLI：

```bash
npm run agentscript -- tutorials/react.as --input '{"question":"What is AgentScript?"}'
npm run agentscript -- tutorials/react.as --check
npm run agentscript -- tutorials/react.as --parse
npm run agentscript -- tutorials/react.as --real-llm --input '{"question":"What is AgentScript?"}'
```

REPL：

- 无参数运行 `agentscript` 进入 REPL。
- `:import <import statement>` 添加 import。
- `:load <file.as>` 加载文件里的 imports 和 agents。
- 每次粘贴一个完整 `agent` 声明作为最小编辑单元。
- `:run [json]` 执行当前 session program。

## 测试范围

测试覆盖：

- tokenizer。
- parser。
- semantic analyzer。
- context builder。
- interpreter runtime。
- LLM provider URI 和请求构造。
- CLI 和 REPL。
- examples parse/check/execute 回归。

常用验证命令：

```bash
npm run typecheck
npm test
npm run build
npm run check -- tutorials/react.as
npm run execute -- tutorials/helloworld.as --input '{}'
npm run execute -- tutorials/cli.as --input '{"name":"Rong","request":"Say hello from AgentScript"}'
node dist/bin/agentscript.js tutorials/react.as --input '{"question":"What is AgentScript?"}' --trace pretty
```
