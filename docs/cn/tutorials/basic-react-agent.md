# 编写一个最基本的 ReAct Agent

ReAct 指的是 **Reason → Act → Observe**：Agent 先判断下一步要做什么，调用工具，把工具结果整理成 observation，然后基于 observation 回答。

这篇教程故意使用一个很简单的工具：通过 `env://process` 读取一个环境变量。这样不需要 MCP 或网络配置，也可以直接运行示例。

完整源码：[`../../../tutorials/react.as`](../../../tutorials/react.as)

## 1. 完整程序

创建 `react.as`，或者直接打开仓库里的 `tutorials/react.as`：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Env from "env://process"

main agent BasicReAct {
    model Qwen
    role "Diagnostic assistant"
    description "Answer one question with a minimal Reason-Act-Observe flow."

    main func(input {
        question: string
    }) {
        env_name = "USER"
        thought = reason(input.question, env_name)
        action = Env.get({
            name: env_name
        })
        observation = observe(input.question, env_name, action)

        answer(input.question, thought, observation)
    }

    func reason(question, env_name) {
        use question as "question"
        use env_name as "planned tool input"

        generate({ input: "Explain why this environment variable may help answer the question", max_output: 300 }) -> {
            why
        }
    }

    func observe(question, env_name, action) {
        use question as "question"
        use env_name as "environment variable"
        use action.value as "environment value"

        generate({ input: "Turn the tool result into a useful observation", max_output: 400 }) -> {
            facts: list[string]
            value_found: boolean
        }
    }

    func answer(question, thought, observation) {
        use question as "question"
        use thought.why as "reasoning note"
        use observation.facts max 1k as "observed facts"
        use observation.value_found as "value found"

        generate({ input: "Answer using only the observation", max_output: 500 }) -> {
            answer
            confidence
        }
    }
}
```

## 2. Reason

`reason` 是规划步骤。它不调用工具，只查看问题和计划使用的工具输入，然后解释为什么这个输入可能有帮助。

关键点是 `use question` 是显式的。以后这个函数可以接收更多参数，但只有被 `use` 选中的值会进入这次模型调用。

## 3. Act

Act 步骤是工具调用：

```agentscript
action = Env.get({
    name: env_name
})
```

模型不会直接调用工具。AgentScript 程序用结构化参数调用工具，这样模型输出和宿主能力之间的边界是清楚的。这个最小教程里把工具输入固定为 `"USER"`，这样示例在 `--mock` 下也能直接运行。

## 4. Observe

`observe` 把原始工具结果整理成适合模型使用的 observation。这样最后回答时依赖的是经过整理的信息，而不是直接依赖未处理的宿主返回值。

## 5. Answer

最后一步使用原始问题、reasoning note 和 observed facts。它不会默认看到所有局部变量；只有被 `use` 选择的值会进入 prompt。

## 6. 运行

先用 mock 模型输出运行：

```bash
agentscript tutorials/react.as --mock --input '{"question":"Which environment variable identifies my shell user?"}'
```

打印 trace，观察 Reason → Act → Observe 的形状：

```bash
agentscript tutorials/react.as --mock --trace --input '{"question":"Which environment variable identifies my shell user?"}'
```

配置好真实模型 provider 后，去掉 `--mock` 就可以调用真实模型。
