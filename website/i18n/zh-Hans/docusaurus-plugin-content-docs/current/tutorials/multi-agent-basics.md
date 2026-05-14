# 多智能体基础

Multi-agent 程序把一个 workflow 拆成多个有名字的 agent，每个 agent 有自己的角色和上下文边界。目的不是让程序变复杂，而是让职责更清楚。

这篇教程构建一个小型写作 workflow：

1. `Coordinator` 接收用户请求。
2. `Researcher` 提取事实。
3. `Writer` 起草答案。
4. `Reviewer` 检查草稿。

<img src="/img/tutorial-7.png" alt="多智能体基础教程概览" width="900" />

完整源码：[`../../../tutorials/multi-agent.as`](https://github.com/rongzhou/agentscript/blob/main/tutorials/multi-agent.as)

## 1. 完整程序

创建 `multi-agent.as`，或者直接打开仓库里的 `tutorials/multi-agent.as`：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent Coordinator {
    model Qwen
    role "Coordinator"
    description "Route a small writing task through specialist agents."

    main func(input {
        topic: string
        audience: string
    }) {
        research = Researcher({
            topic: input.topic
        })

        draft = Writer({
            topic: input.topic,
            audience: input.audience,
            research: research
        })

        review = Reviewer({
            topic: input.topic,
            audience: input.audience,
            draft: draft
        })

        {
            research: research,
            draft: draft,
            review: review
        }
    }
}

agent Researcher {
    model Qwen
    role "Researcher"
    description "Extract a few useful facts for a topic."

    main func(input {
        topic: string
    }) {
        use input.topic as "topic"

        generate({ input: "List a few useful facts for this topic", max_output: 500 }) -> {
            facts: list[string]
            angle
        }
    }
}

agent Writer {
    model Qwen
    role "Writer"
    description "Draft a short answer for a specific audience."

    main func(input {
        topic: string
        audience: string
        research: json
    }) {
        use input.topic as "topic"
        use input.audience as "audience"
        use input.research.facts max 1k as "research facts"

        generate({ input: "Write a concise draft", max_output: 600 }) -> {
            title
            body
        }
    }
}

agent Reviewer {
    model Qwen
    role "Reviewer"
    description "Review whether a draft fits the topic and audience."

    main func(input {
        topic: string
        audience: string
        draft: json
    }) {
        use input.topic as "topic"
        use input.audience as "audience"
        use input.draft as "draft"

        generate({ input: "Review the draft and suggest improvements", max_output: 500 }) -> {
            ok: boolean
            notes: list[string]
        }
    }
}
```

## 2. Coordinator 调用其它 Agent

调用 agent 看起来像调用函数：

```agentscript
research = Researcher({
    topic: input.topic
})
```

`Researcher` 只会收到传给它的对象。它不会自动看到 coordinator 的局部变量、prompt context 或之前的 agent 调用。

## 3. 每个 Agent 有自己的角色

`Researcher`、`Writer` 和 `Reviewer` 都声明自己的 `role` 和 `description`。即使它们使用同一个 LLM provider，每次模型调用也会有不同的身份。

这就是拆分 agent 的实际价值：prompt identity 和 context boundary 都变得明确。

## 4. Context 不会自动跨 Agent 传播

`Writer` 收到了 `research` 输入，但它仍然要显式选择给模型看的内容：

```agentscript
use input.research.facts max 1k as "research facts"
```

在 agent 之间传递数据，和把数据暴露给模型，是两个不同步骤。

## 5. 运行

用 mock 输出运行：

```bash
agentscript tutorials/multi-agent.as --mock --input '{"topic":"AgentScript context boundaries","audience":"new users"}'
```

打印 trace，可以看到嵌套的 agent 调用：

```bash
agentscript tutorials/multi-agent.as --mock --trace --input '{"topic":"AgentScript context boundaries","audience":"new users"}'
```

## 下一步

下一篇教程可以把这个结构用于一个真正的 multi-agent 应用模式，例如 planner → implementer → reviewer，或 researcher → critic → writer。
