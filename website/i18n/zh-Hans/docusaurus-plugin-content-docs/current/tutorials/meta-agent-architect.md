# 用 Architect 构建 Meta\-Agent（AgentScript 教程）

本文将详细讲解如何使用 AgentScript 构建一个 Meta\-Agent——简单来说，就是一个「能帮你创建其他 AgentScript 智能体（Agent）的智能体」。

本教程的核心约束的是：大模型（LLM）**不会直接编写 \.as 源码**。它会先生成一份 AgentSpec JSON 规范文件，随后由 AgentScript 完成三件事：验证这份规范的合法性、必要时自动修复问题、通过确定性编译生成源码，最后用 AgentScript 原生的解析器（parser）和语义分析器（semantic analyzer），对生成的源码进行校验，确保其可正常运行。

整个工作流程的核心边界清晰可追溯，步骤如下：

```text
自然语言需求
  -> LLM 生成 AgentSpec JSON 草案
  -> host://architect 验证 spec 合法性
  -> （可选）自动修复 spec 中的问题
  -> 确定性编译器生成 AgentScript 源码
  -> parser/analyzer 校验生成的源码
```

完整示例源码：
[`examples/meta/architect.as`](https://github.com/rongzhou/agentscript/blob/main/examples/meta/architect.as)

## 1\. 为什么不让模型直接写源码？

虽然大模型具备编写代码的能力，但如果直接提示它「写一个 AgentScript 程序」，会给模型过大的自由发挥空间，进而引发一系列问题：

- 随意发明 AgentScript 语法，与当前语言设计脱节；

- 生成的源码看似合理，却无法通过语义分析，无法实际运行；

- 将核心结构决策隐藏在冗余文本中，难以审计和修改。

而 AgentSpec 则大幅收窄了模型的输出范围——模型只需用 JSON 格式，清晰描述智能体的核心信息即可，无需关注源码细节：

- 使用哪个模型 URI（如 Ollama、OpenAI 等）；

- 智能体接受哪些输入参数；

- 需要调用哪些工具；

- 哪些工具的返回结果会传入模型上下文；

- 最终的生成指令（generation instruction）是什么；

- 智能体需要返回哪些结构化输出字段。

至于源码的生成，完全由 AgentScript 的编译器负责，确保语法规范、逻辑一致。

## 2\. 查看 Meta\-Agent 核心代码

首先打开示例文件 \`examples/meta/architect\.as\`，核心代码如下（关键部分已标注）：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Architect from "host://architect"  // 导入内置 Architect 工具链

main agent AgentScriptArchitect {
    model Qwen  // 指定用于生成 spec 的模型
    role "AgentScript meta-agent architect"
    description "Generate AgentScript agents from natural-language requirements."

    main func(input {
        request: string          // 用户的自然语言需求
        target_name: string      // 目标智能体的名称
        model_uri: string        // 偏好使用的模型 URI
    }) {
        // 显式声明模型可见的上下文
        use input.request as "user agent requirement"
        use input.target_name as "target agent name"
        use input.model_uri as "preferred model uri"

        // 让模型生成 AgentSpec 草案（而非源码）
        draft = generate({
            input: "...",  // 实际使用时填写具体指令，引导模型生成 spec
            max_output: 9000
        }) -> {
            spec: json                   // 核心：AgentSpec JSON 草案
            assumptions: list[string]    // 模型的假设（如工具可用性）
            missing_requirements: list[string]  // 缺失的需求信息
        }

        // 调用 Architect 工具验证 spec 合法性
        validation = Architect.validateSpec({
            spec: draft.spec
        })
    }
}
```

重点说明：

第一个 \`generate\` 调用的核心目标，是让模型输出结构化的 \`spec\`（JSON 格式），而非直接生成 AgentScript 源码，这是 Meta\-Agent 最关键的设计。

代码中导入的 \`Architect\` 是 AgentScript 内置的工具链，通过 \`host://architect\` 访问（本地宿主能力），它提供三个核心方法，支撑整个 Meta\-Agent 流程：

- \`Architect\.validateSpec\`：验证 AgentSpec 的合法性，返回校验结果和错误信息；

- \`Architect\.compileSpec\`：将合法的 AgentSpec 编译成 AgentScript 源码；

- \`Architect\.analyzeSource\`：对生成的源码进行解析和语义分析，确保可运行。

## 3\. Spec 的验证与修复（Meta\-Agent 核心流程）

Meta\-Agent 首先会调用 \`validateSpec\` 方法，对模型生成的 draft spec 进行验证：

```agentscript
validation = Architect.validateSpec({
    spec: draft.spec
})
```

如果验证失败（\`validation\.ok\` 为 false），Meta\-Agent 会将详细的错误诊断信息（diagnostics）反馈给模型，引导模型仅修复 AgentSpec 中的问题，不改变用户需求和智能体核心行为：

```agentscript
if not validation.ok {
    use draft.spec as "draft AgentSpec"
    use validation as "validation diagnostics"  // 将错误信息传入模型上下文

    repair = generate({
        input: "仅修复 AgentSpec JSON 对象，严格遵循验证诊断信息，不改变用户需求和智能体核心行为，修复后仍为标准 JSON 格式...",
        max_output: 9000
    }) -> {
        spec: json               // 修复后的 AgentSpec
        repair_summary: string   // 修复总结（说明修复了哪些问题）
    }

    repaired = repair.spec
    repair_summary = repair.repair_summary
}
```

这是 Meta\-Agent 的核心工作模式，总结为4步：

1. 让 LLM 生成结构化的 AgentSpec 草案（而非源码）；

2. 用确定性工具（\`validateSpec\`）验证草案合法性；

3. 将精确的错误诊断信息反馈给模型，明确修复方向；

4. 让模型聚焦于「修复 Spec 错误」，不偏离用户需求和语法规范。

注意：修复提示（prompt）的核心是「收窄修复范围」——不要求模型重写整个 Spec，只修复无效的格式、引用和类型问题，保留用户期望的智能体行为。

## 4\. Spec 编译与源码分析

当 AgentSpec 验证通过（或修复后通过），Meta\-Agent 会调用 \`compileSpec\` 方法，将 Spec 编译成 AgentScript 源码：

```agentscript
compiled = Architect.compileSpec({
    spec: repaired  // 传入修复后的合法 Spec
})
```

如果编译成功（\`compiled\.ok\` 为 true），会进一步调用 \`analyzeSource\` 方法，对生成的源码进行解析和语义分析，确保其与手写的 AgentScript 源码具备相同的合法性：

```agentscript
if compiled.ok {
    source = compiled.source  // 编译生成的 AgentScript 源码
    analysis = Architect.analyzeSource({
        source: source
    })
}
```

只有当 \`analysis\.ok\` 为 true 时，CLI 才会将生成的 \`\.as\` 文件写入本地——这意味着，生成的源码已经通过了 AgentScript 原生的语法和语义校验，可以直接运行或进一步修改。

## 5\. 用 Mock 模式测试流程（无需调用真实模型）

在正式调用真实模型前，我们可以用 \`\-\-mock\` 模式运行示例，验证整个流程的完整性（模型会返回确定性占位值，不发起真实调用）：

```bash
agentscript examples/meta/architect.as --mock --input '{
  "request": "Build a docs assistant that searches documentation and returns answers with citations",
  "target_name": "DocsAssistant",
  "model_uri": "ollama://localhost:11434/qwen3.6"
}'
```

说明：

- \`\-\-mock\` 模式下，LLM 调用、外部工具调用、记忆调用都会被模拟，但内置的 \`host://\` 工具（如 Architect）会真实执行；

- 这种方式无法验证「生成的智能体是否有用」，但可以快速确认：AgentScript 程序结构有效、工具调用链连接正常、流程无报错。

## 6\. 直接编译已审核的 AgentSpec（绕开自然语言流程）

如果已经有一份经过人工审核的合法 AgentSpec，无需通过自然语言生成，可直接用 CLI 验证并编译：

第一步：验证 Spec 合法性：

```bash
agentscript architect --check fixtures/architect/docs-assistant.spec.json
```

第二步：将 Spec 编译成 AgentScript 源码（输出到指定路径）：

```bash
agentscript architect --spec fixtures/architect/docs-assistant.spec.json /tmp/docs-assistant.as
```

第三步：查看生成的源码（前120行）：

```bash
sed -n '1,120p' /tmp/docs-assistant.as
```

注意：这个编译流程是**完全确定性**的，编译器不会调用任何模型，仅根据 Spec 生成固定格式的源码。

## 7\. 编译 ReAct 模式的 AgentSpec

AgentSpec 支持 Phase 1 ReAct 模式（Reason\-Act 循环），我们可以直接编译一份已审核的 ReAct 示例 Spec：

第一步：验证 ReAct Spec 合法性：

```bash
agentscript architect --check fixtures/architect/react-research-agent.spec.json
```

第二步：编译生成源码：

```bash
agentscript architect --spec fixtures/architect/react-research-agent.spec.json /tmp/react-research-agent.as
```

生成的源码中，会自动包含 ReAct 循环逻辑（核心代码如下）：

```agentscript
scratch = []
use scratch.summary max 4k as "observations"
done = false

loop until done max 6 {
    thought = generate({
        input: "Look at the observations so far. Pick the next focused query, or set done=true if you can answer.",
        max_output: 400
    }) -> {
        focus: string
        done: boolean
    }

    obs = Search.query({
        q: thought.focus
    })
    scratch.add(obs)
    done = thought.done
}
```

而这份 ReAct 逻辑，对应的 AgentSpec JSON 规范如下（核心是通过 \`pattern: \&\#34;react\&\#34;\` 声明模式）：

```json
{
  "pattern": "react",
  "react": {
    "max_iterations": 6,  // 最大循环次数
    "scratch": { "label": "observations", "max": "4k" },  // 临时存储观测结果
    "reason": {
      "input": "Look at the observations so far. Pick the next focused query, or set done=true if you can answer.",
      "max_output": 400,
      "output": {
        "fields": {
          "focus": { "type": "string" },  // 下一轮查询关键词
          "done": { "type": "boolean" }   // 是否结束循环
        }
      }
    },
    "act": {
      "tool": "Search",  // 调用的工具
      "method": "query", // 工具方法
      "args": { "q": "thought.focus" }   // 方法参数
    },
    "stop_when": "thought.done"  // 循环终止条件
  }
}
```

补充说明：本教程中的 Phase 1 ReAct 模式是刻意收窄的——仅支持一个推理步骤（reason）、一个预声明的工具方法、一次观测结果追加（scratch\.add），以及一个明确的终止条件。如果需要模型在运行时动态选择多个工具，属于 AgentSpec 未来的扩展方向，暂不支持。

## 8\. 从自然语言生成完整智能体（真实模型调用）

要运行完整的 Meta\-Agent 流程（从自然语言需求到生成可运行源码），需要指定真实的模型 URI，执行以下命令（以 Ollama 为例）：

```bash
AGENTSCRIPT_LLM_TIMEOUT_MS=120000 \
agentscript architect \
  "build a docs assistant that searches documentation and returns answers with citations" \
  /tmp/docs-assistant.as \
  --model ollama://localhost:11434/qwen3.6:latest
```

关键说明：

- \`AGENTSCRIPT\_LLM\_TIMEOUT\_MS=120000\`：设置模型调用超时时间（120秒），避免生成 Spec 耗时过长导致报错；

- CLI 内部会自动调用 \`examples/meta/architect\.as\`，并向 Meta\-Agent 传入三个核心输入：
        

    - \`request\`：用户的自然语言需求（上述命令中的英文句子，也可直接使用中文需求）；

    - \`target\_name\`：从输出文件名（\`/tmp/docs\-assistant\.as\`）中推断，即 \`docs\-assistant\`；

    - \`model\_uri\`：通过 \`\-\-model\` 参数指定，用于生成目标智能体时使用。

- \`model\_uri\` 仅作为提示（hint），不强制改写——生成智能体后，建议先人工审核源码，确认模型选择、工具 URI 等信息是否符合预期。

## 9\. 检查生成的智能体（必做步骤）

生成源码后，务必先对其进行语义分析，确认无语法和逻辑错误：

```bash
agentscript /tmp/docs-assistant.as --check
```

同时，建议查看生成的 \`import\` 语句——从简单需求生成的智能体，可能会包含占位符工具 URI，例如：

```agentscript
import tool DocsSearchTool from "mcp://docs"
```

这种占位符适合教程演示，但在真实项目中，需要将 \`mcp://docs\` 替换为实际的 MCP 服务器地址或工具提供商地址，确保工具能正常调用。

## 10\. 尝试生成无工具智能体

Meta\-Agent 会根据需求自动判断是否需要工具——对于纯文本处理任务（无需外部工具调用），会生成无工具导入的智能体。例如，生成一个邮件分类智能体：

```bash
AGENTSCRIPT_LLM_TIMEOUT_MS=120000 \
agentscript architect \
  "build an email triage assistant that classifies an incoming email by urgency and category, explains the decision briefly, and suggests the next action" \
  /tmp/email-triage.as \
  --model ollama://localhost:11434/qwen3.6:latest
```

生成后，先进行校验：

```bash
agentscript /tmp/email-triage.as --check
```

这类无工具智能体，通常会包含以下核心内容：

- 输入字段：\`email\_body\`（邮件正文）、\`subject\`（邮件主题）、\`sender\_name\`（发件人姓名）等；

- 工具配置：\`tools: \[\]\`（空数组，无工具导入）；

- 上下文：仅包含上述输入字段；

- 输出字段：\`urgency\`（紧急程度）、\`category\`（分类）、\`reasoning\`（决策说明）、\`next\_action\`（下一步建议）等。

## 11\. 这个模式能保证什么？（核心契约）

Architect 工作流虽然不能保证生成「完美的产品级智能体」，但能提供一个狭窄但实用的核心契约，确保生成过程的可靠性和可审计性：

- 通过验证的 AgentSpec，一定会编译成合法的 AgentScript 源码；

- 编译器是完全确定性的，不调用任何 LLM，生成结果可复现；

- 生成的源码，会用与手写源码相同的 analyzer 进行校验，确保语法和逻辑无误；

- 验证器（validator）返回的错误诊断信息足够结构化，能精准引导模型修复问题。

注意：仍需人工审核生成的源码——包括模型假设、工具 URI、输出字段和提示词，确保其符合实际业务需求。

## 12\. 下一步实验方向

当你希望让模型辅助智能体设计，但又不想让模型直接控制源码文本时，Architect 模式会非常实用。以下是几个推荐的后续实验方向，帮助你进一步适配自身项目：

- 为自己的项目，添加更多符合业务场景的 AgentSpec 示例（fixtures）；

- 针对你常用的本地模型（如 Qwen、Llama 等），调优 \`examples/meta/architect\.as\` 中的提示词，提升 Spec 生成质量；

- 编写项目专用的 Meta\-Agent，限制工具 URI 的范围，只允许生成包含你批准过的工具调用的智能体；

- 当现有的 \`linear\` 和 \`react\` 模式无法满足需求时，为 AgentSpec 扩展新的模式（pattern），支持更复杂的智能体逻辑。

> （注：文档部分内容可能由 AI 生成）
