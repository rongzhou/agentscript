# Multi-Agent Review Pattern

上一篇教程介绍了 agent 边界。这篇把这些边界用到一个具体应用模式里：并行 specialist review。

这个 workflow 是：

1. `Planner` 决定 review focuses。
2. 多个 `Reviewer` agent 从不同角度审阅同一个 draft。
3. `Editor` 把审阅结果合并成最终修改建议。

完整源码：[`../../../tutorials/multi-agent-review.as`](../../../tutorials/multi-agent-review.as)

## 1. 完整程序

创建 `multi-agent-review.as`，或者直接打开仓库里的 `tutorials/multi-agent-review.as`：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent ReviewCoordinator {
    model Qwen
    role "Review coordinator"
    description "Run parallel specialist reviews and consolidate the feedback."

    main func(input {
        draft: string
        audience: string
    }) {
        review_plan = Planner({
            audience: input.audience
        })

        reviewers = [
            {
                name: "clarity",
                focus: review_plan.clarity_focus
            },
            {
                name: "accuracy",
                focus: review_plan.accuracy_focus
            },
            {
                name: "usefulness",
                focus: review_plan.usefulness_focus
            }
        ]

        reviews = parallel for reviewer in reviewers max 3 {
            Reviewer({
                draft: input.draft,
                audience: input.audience,
                reviewer: reviewer
            })
        }

        Editor({
            draft: input.draft,
            audience: input.audience,
            reviews: reviews
        })
    }
}

agent Planner {
    model Qwen
    role "Review planner"
    description "Choose review focuses for a target audience."

    main func(input {
        audience: string
    }) {
        use input.audience as "audience"

        generate({ input: "Create three review focuses for this audience", max_output: 400 }) -> {
            clarity_focus
            accuracy_focus
            usefulness_focus
        }
    }
}

agent Reviewer {
    model Qwen
    role "Specialist reviewer"
    description "Review a draft from one focused perspective."

    main func(input {
        draft: string
        audience: string
        reviewer: json
    }) {
        use input.audience as "audience"
        use input.reviewer as "review focus"
        use input.draft max 2k as "draft"

        generate({ input: "Review the draft from this focus", max_output: 500 }) -> {
            reviewer
            strengths: list[string]
            issues: list[string]
            recommendation
        }
    }
}

agent Editor {
    model Qwen
    role "Editor"
    description "Merge specialist reviews into final editorial guidance."

    main func(input {
        draft: string
        audience: string
        reviews: list[json]
    }) {
        use input.audience as "audience"
        use input.draft max 2k as "draft"
        use input.reviews.summary max 3k as "specialist reviews"

        generate({ input: "Create final revision guidance from the reviews", max_output: 700 }) -> {
            summary
            priority_fixes: list[string]
            ready_to_publish: boolean
        }
    }
}
```

## 2. 规划 Review Focuses

`Planner` 根据 audience 生成三个 review focus。这样后面的 reviewer 会保持方向一致，但不需要共享一个巨大的 prompt。

## 3. 并行运行 Specialist Reviewers

每个 reviewer 都收到同一份 draft 和 audience，但 focus 不同：

```agentscript
reviews = parallel for reviewer in reviewers max 3 {
    Reviewer({
        draft: input.draft,
        audience: input.audience,
        reviewer: reviewer
    })
}
```

这是 `parallel for` 很适合的场景：clarity reviewer 不依赖 accuracy reviewer，二者可以独立运行。

## 4. 用 Editor 汇总

`Editor` 不需要 coordinator 的所有中间变量。它只接收 draft、audience 和 review results，然后再选择给最终模型调用看的内容：

```agentscript
use input.reviews.summary max 3k as "specialist reviews"
```

当你需要多角度反馈，但最终只要一个回答时，这个模式很有用。

## 5. 运行

用 mock 输出运行：

```bash
agentscript tutorials/multi-agent-review.as --mock --input '{"audience":"new users","draft":"AgentScript lets you choose exactly what context enters each model call."}'
```

打印 trace，可以看到 planner、并行 reviewers 和 editor：

```bash
agentscript tutorials/multi-agent-review.as --mock --trace --input '{"audience":"new users","draft":"AgentScript lets you choose exactly what context enters each model call."}'
```

## 下一步

现在你已经有了主要结构工具：ReAct、流程控制、Plan-and-Execute 和 multi-agent review。下一步可以进入 memory 和 reflection，让 agent 在多次运行之间保存经验。
