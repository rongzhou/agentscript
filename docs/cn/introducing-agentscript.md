# 模型到底看到了什么？

介绍 AgentScript：一门让 LLM context 显式、有作用域、可审计的小语言。

我这一代的很多程序员，最早都是通过一个简单模型理解计算的：输入、处理、输出。

程序接收数据，转换数据，然后产生结果。这是一个很古老的心智模型，但今天仍然有用。它让程序显得可以理解，因为边界是可见的。

LLM agent 拉伸了这个模型。

输入不再只是一个文件、一个请求，或一个形状已知的记录。输入变成了 prompt context：用户意图、工具观察、检索文档、记忆记录、中间状态、重试消息，以及其他 agent 的输出。

输出也不再只是普通返回值。它可能是生成文本，也可能是 JSON，并且在下一步信任它之前，还需要满足某个契约。

大多数 agent 程序并不是因为调用模型很难而失败。

它们失败，是因为没有人能有把握地说清楚：模型在生成下一个值之前，到底看到了什么。

运行几个回合之后，agent 会积累局部变量、工具结果、记忆记录、中间观察、重试消息和其他 agent 的输出。其中一些数据应该进入下一次模型调用，另一些不应该。在大多数 Python 或 TypeScript agent 中，这条边界靠约定维护。

这对小 demo 有效。但在真实 workflow 里会变得脆弱。

模型到底看到了什么？哪个工具结果进入了 prompt，哪个只是本地数据？Memory 是否被裁剪？另一个 agent 的输出是作为证据进入，还是作为上一轮 assistant text 进入？模型必须返回什么样的值，下一步才能继续信任它？

AgentScript 是一个实验：让这些问题可以直接从程序本身回答。

## AgentScript 是什么

AgentScript 是一门用于构建 LLM agent 的小语言，它让 prompt context 变得显式、有作用域、有类型、可追踪、可审计。

它面向的是构建多步骤 agent 的开发者：这些 agent 需要控制并审计工具输出、记忆、中间状态和生成值如何流动。

它不是 prompt template 格式。不是 YAML 配置。也不是通用 agent framework。

它的核心想法很简单：

> Agent context should be code.

最重要的两个语言特性是 `use` 和 `generate`。

```agentscript
use content max 8k as "file content"

generate({
    input: "Summarize the file for a busy teammate",
    max_output: 1000
}) -> {
    title
    summary
    key_points list[string]
    action_items list[string]
}
```

`use` 声明模型允许看到什么。`generate` 声明模型在哪里被调用，并在需要时声明输出必须满足什么形状。在旧的输入、处理、输出框架里，AgentScript 把语言层面的注意力放在 LLM 程序最不稳定的两条边上：prompt 输入和生成输出。

重点不是 AgentScript 能调用 LLM。重点是 prompt 边界在代码里是可见的。

语言里的其他东西都服务于这个 workflow：变量、函数、agent、import、循环、工具、记忆和 trace output。

## 为什么不直接用 Python 或 TypeScript？

Python 和 TypeScript 是优秀的通用语言，AgentScript 并不试图取代它们。

问题在于，它们没有 prompt context 这个原生概念。Context 通常表现为字符串、数组、对象、template、framework call 或 message list。程序可能是正确的，但意图散落在普通代码里：

```ts
const messages = [
  system("You are a reviewer"),
  user(`Question: ${input.question}`),
  user(`Search results: ${JSON.stringify(results)}`),
  user(`Memory: ${memory.map((item) => item.text).join("\n")}`),
];

const answer = await model.generate(messages);
```

`results` 里的哪些字段被包含了？原始工具输出是否进入了 prompt？Memory 是否被裁剪？其他 agent 的输出是作为 evidence 进入，还是作为 prior assistant text 进入？`answer` 必须满足什么 schema？

AgentScript 把 context selection 变成一等操作：

```agentscript
use input.question as "user question"
use results.summary max 4k as "search results"
use past max 2k as "past lessons"

generate({
    input: "Answer using only the selected context",
    max_output: 800,
    strict: true
}) -> {
    answer
    citations list[string]
}
```

Label 可以是简单 identifier，也可以是 quoted string。

局部变量不会自动进入 prompt。工具结果不会自动进入 prompt。记忆查询结果不会自动进入 prompt。Trace event 也不会自动进入 prompt。

如果某个数据应该对模型可见，它必须用 `use` 显式选择。

这一条规则会改变 agent 开发的形态。Prompt 不再是任意字符串拼接的副作用。它是一个有作用域的契约。

## 一个最小示例

下面是一个完整的文件摘要 agent：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool File from "file://workspace"

main agent FileSummarizer {
    model Qwen
    role "Technical Writer"
    description "Read one local file and produce a useful structured summary."

    main func(input { path string }) {
        content = File.read({
            path: input.path
        })

        use input.path as "source path"
        use content max 8k as "file content"

        generate({
            input: "Summarize the file for a busy teammate",
            max_output: 1000
        }) -> {
            title
            summary
            key_points list[string]
            action_items list[string]
        }
    }
}
```

File tool 可以从 workspace 读取文件，但工具结果不会隐式变成 prompt context。程序显式选择 path 和 file content，给它们加 label，给 content 设置 budget，然后要求模型返回结构化结果。

用真实模型运行：

```bash
agentscript recipes/summarize-file.as --input '{"path":"README.md"}'
```

也可以立刻用确定性 mock output 和 trace 试一下：

```bash
npm install -g @rong/agentscript
agentscript recipes/summarize-file.as --input '{"path":"README.md"}' --mock --trace
```

用确定性的 mock model 运行：

```bash
agentscript recipes/summarize-file.as --input '{"path":"README.md"}' --mock
```

不调用模型，只检查 prompt 和 trace：

```bash
agentscript recipes/summarize-file.as --input '{"path":"README.md"}' --dry-run
```

打印可审计 trace：

```bash
agentscript recipes/summarize-file.as --input '{"path":"README.md"}' --trace
```

Trace 可以展示哪些 context source 被选择、应用了哪些 budget、哪些内容被裁剪、使用了什么 instruction、请求了什么 output shape，以及 validation 是否通过。Trace 用于 debugging 和 audit。它本身不是 prompt context。

例如，trace 里最有价值的部分不只是“调用了模型”，而是这次调用周围的边界：

```text
Generate #1
Agent: FileSummarizer / Technical Writer
Selected context:
  [source path] input.path
  [file content] content, budget=8k, clipped=false
Instruction:
  Summarize the file for a busy teammate
Output shape:
  title string
  summary string
  key_points list[string]
  action_items list[string]
Validation: ok
```

## `generate` 是唯一的 LLM 调用点

在 AgentScript 中，普通代码可以计算值、调用工具、查询记忆、调用其他 agent，并组织中间状态。只有 `generate` 会请求模型生成新输出。

```agentscript
answer = generate({
    input: "Answer using only the selected context.",
    max_output: 800,
    attempts: 3,
    strict: true
}) -> {
    ok boolean
    answer
    citations list[string]
}
```

`->` 后面的 shape 是输出契约。AgentScript 可以在 provider 支持时请求 structured output，校验返回值，并在模型返回 invalid JSON 或 shape 不匹配时重试。下游代码可以依赖返回值的形状，而不是解析一段自然语言。

这让每一次模型调用都有清晰边界：

- 当前 agent identity
- 可见 `use` 声明选择的 context
- `generate({ input: ... })` 中的本地 instruction
- `->` 后面的可选输出契约

这条边界就是你可以 review、debug 和 trace 的单元。

## Scope 就是 Context 边界

AgentScript 使用 scope 控制 prompt 可见性。

这也是一种缓解长对话记忆压力的方式。传统 chat loop 往往会在同一段 history 后面不断 append 新消息。Context 会随着时间越来越臃肿，下一次模型调用也会继承这段对话偶然积累下来的东西。

AgentScript 对每一次 generation 的处理不同。在 `generate` 之前，程序用 `use` 有意识地选择可见 context：这一轮真正需要的具体值、label 和 budget。它更像是精确采样，而不是无止境地追加历史。

`use` 声明对同一 scope 和 child scope 中后续的 `generate` 可见。它不会向上泄漏。Function call 和 agent call 会创建独立的 context boundary。

```agentscript
func caller(input) {
    use input.goal as goal
    helper(input)
}

func helper(input) {
    use input.detail as detail

    generate({ input: "Work on the detail" }) -> {
        ok boolean
    }
}
```

`helper` 里的 `generate` 能看到 `input.detail`。它不会自动继承 `caller` 选择的 `goal` context。

Agent call 也以同样方式隔离。被调用的 agent 只看到传给它的 input value，以及它自己函数里选择的 context。它不会继承调用者的 prompt context。

这让 multi-agent composition 更容易审计。每个 agent 都有自己的 prompt contract，而不是共享一个 ambient conversation buffer。

## Tool Results 是数据，不是 Prompt

AgentScript 最重要的规则之一是：工具结果是本地程序数据。它们只有在被选择后才是 prompt context。

这对 repository review、research、code analysis，以及任何工具可能返回大量数据的 workflow 都很重要。模型通常不应该看到工具返回的所有内容。

一个 repository review 可以收集 file tree、TODO matches、package metadata 和 CI configuration。Review step 之后可以只选择相关部分：

```text
use "file tree"          budget=8k
use "todo findings"      budget=4k
use "package metadata"   budget=4k
use "ci configuration"   budget=4k
generate                 blockers, risks, quick_wins, next_steps
```

这一区分是有意设计的。

**Tools 扩展程序能做什么。`use` 控制模型能看到什么。**

## Memory 也是显式的

AgentScript 包含 file JSONL 和 SQLite memory backend，但 memory 遵循同样规则。

Memory handle 是一种 capability，不是 prompt data：

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
```

Agent 必须查询 memory，得到普通数据，然后在这些数据应该影响下一次 generation 时显式选择它们：

```agentscript
past = Lessons.query({
    text: input.goal,
    kind: "lesson",
    limit: 5
})

use input.goal as goal
use past max 2k as "past lessons"
```

写入 memory 也是显式的：

```agentscript
Lessons.add({
    kind: "lesson",
    text: reflection.insight,
    goal: input.goal
})
```

这支持 reflection 和 self-improvement，同时避免 context 自动膨胀。未来运行可以使用 durable lessons，但只能通过可见的 query 和可见的 `use`。

## Agent Patterns 是可组合原语

AgentScript 不把 agent pattern 硬编码成 keyword。

没有特殊的 `planner` keyword。没有特殊的 `executor` keyword。也没有特殊的 `reflect` keyword。这些名字只是程序里的 agent、function 或普通数据。

这是刻意的。ReAct、plan-and-execute、evaluator-optimizer、reflection、self-improvement 和 multi-agent workflow 都可以由同一组小原语构建：

- agents 和 functions 用于边界
- tools 用于外部能力
- memory 用于 durable explicit state
- `use` 用于 prompt context selection
- `generate` 用于模型调用和输出契约
- trace 用于 auditability

对于独立、有界的工作，AgentScript 还提供 `parallel for`：

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor({
        goal: input.goal,
        step: step
    })
}
```

对于有界的独立工作，`parallel for` 面向 multi-agent 和 multi-generate 的瓶颈设计，但不暴露 `async`/`await`。

结果仍然是本地数据。只有被选择后，它才进入后续 prompt：

```agentscript
use results.summary max 6k as execution_results
```

## 当前状态

AgentScript 仍然是实验性的，但核心语言设计已经到位。

目前已实现：

- parser
- semantic checker
- mock runtime
- OpenAI、Anthropic 和 Ollama LLM adapters
- file、environment、HTTP 和 shell-style host tools
- JSONL 和 SQLite memory backends
- structured output validation
- trace output
- arithmetic 和 comparison operators
- compound assignment
- `parallel for`
- `parallel for` runtime concurrency control
- CLI 支持 `--mock`、`--dry-run`、`--trace`、`--check` 和 `--concurrency`

当前实现已经可以用于实验、示例和本地 workflow，但语言仍然是 pre-1.0，未来可能变化。

计划中的工作包括 stable IR、更丰富的 diagnostics，以及 VS Code syntax support。

项目仍然很早期。现在的目标不是宣称 AgentScript 已经是成熟的 production framework，而是测试一个更尖锐的语言想法：

> 如果 agent 程序最重要的部分不是模型调用周围的 framework，而是模型调用之前的 context contract，会怎样？

## 试用

安装 CLI：

```bash
npm install -g @rong/agentscript
```

运行一个 recipe：

```bash
agentscript recipes/summarize-file.as --input '{"path":"README.md"}'
```

不安装直接运行：

```bash
npx @rong/agentscript recipes/code-review.as --input '{"path":"src"}'
```

使用 mock mode 做确定性本地检查：

```bash
agentscript recipes/summarize-file.as --input '{"path":"README.md"}' --mock
```

使用 trace mode 检查执行过程：

```bash
agentscript recipes/summarize-file.as --input '{"path":"README.md"}' --trace
```

项目链接：

- npm: https://www.npmjs.com/package/@rong/agentscript
- GitHub: https://github.com/rongzhou/agentscript

## 结语

LLM agents 经常被描述为 tools、memory、planning 和 autonomy 的组合。这些东西都重要，但它们都依赖一个更基础的问题：

模型在生成下一个值之前，到底看到了什么？

AgentScript 围绕这个问题构建。它把 prompt context 视为一种可以声明、限定作用域、设置 budget、加 label、校验并追踪的东西。

这就是这门语言的赌注：可靠的 agent 需要让 context engineering 成为一种 programming model，而不是一堆约定。
