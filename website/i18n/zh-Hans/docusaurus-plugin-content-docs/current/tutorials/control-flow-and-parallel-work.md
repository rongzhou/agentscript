# 流程控制与并行工作

这篇教程介绍构建更大 agent 模式前最常用的流程控制能力：

- `if`：分支
- `for`：顺序处理
- `parallel for`：并发处理互相独立的任务
- `loop until`：有上限的重试或迭代

<img src="/agentscript/img/tutorial-5.png" alt="流程控制与并行工作教程概览" width="900" />

示例是一个小型批处理 coordinator：把 urgent 和 regular item 分开，对每个 item 独立分类，检查这批结果是否足够，然后生成总结。

完整源码：[`../../../tutorials/control-flow.as`](https://github.com/rongzhou/agentscript/blob/main/tutorials/control-flow.as)

## 1. 完整程序

创建 `control-flow.as`，或者直接打开仓库里的 `tutorials/control-flow.as`：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent ControlFlowExample {
    model Qwen
    role "Batch coordinator"
    description "Classify a small batch, process independent items in parallel, and summarize the result."

    main func(input {
        goal: string
        items: list[json]
    }) {
        urgent = []
        regular = []

        for item in input.items max 10 {
            if item.urgent {
                urgent.add(item)
            } else {
                regular.add(item)
            }
        }

        classified = parallel for item in input.items max 5 {
            classify(input.goal, item)
        }

        ready = false
        attempts = 0
        verdict = {
            ready: false,
            note: "not checked yet"
        }

        loop until ready max 2 {
            attempts += 1
            verdict = check(input.goal, classified, attempts)
            ready = verdict.ready
        }

        finish(input.goal, urgent, regular, classified, verdict, attempts)
    }

    func classify(goal, item) {
        use goal as "batch goal"
        use item as "item"

        generate({ input: "Classify this item for the batch goal", max_output: 300 }) -> {
            label
            reason
        }
    }

    func check(goal, classified, attempts) {
        use goal as "batch goal"
        use classified.summary max 2k as "classified items"
        use attempts as "attempt"

        generate({ input: "Decide whether the batch is ready to summarize", max_output: 300 }) -> {
            ready: boolean
            note
        }
    }

    func finish(goal, urgent, regular, classified, verdict, attempts) {
        use goal as "batch goal"
        use urgent.summary max 1k as "urgent items"
        use regular.summary max 1k as "regular items"
        use classified.summary max 2k as "classified items"
        use verdict as "readiness verdict"
        use attempts as "attempts"

        generate({ input: "Summarize the batch result", max_output: 600 }) -> {
            summary
            urgent_count: number
            regular_count: number
            ready: boolean
        }
    }
}
```

## 2. 用 `if` 做分支

第一段循环把 urgent item 和 regular item 分开：

```agentscript
for item in input.items max 10 {
    if item.urgent {
        urgent.add(item)
    } else {
        regular.add(item)
    }
}
```

这里的 `max 10` 是刻意写出来的边界。Agent workflow 里的循环最好有明确上限，尤其是循环体以后可能调用工具或模型时。

## 3. 用 `parallel for` 处理独立任务

每个 item 的分类互不依赖，所以这里使用 `parallel for`：

```agentscript
classified = parallel for item in input.items max 5 {
    classify(input.goal, item)
}
```

当每次迭代不依赖上一次迭代的结果时，适合用 `parallel for`。如果下一个 item 需要前一个 item 的结果，就应该用普通 `for`。

## 4. 用 `loop until` 做有界迭代

当 agent 需要少量重试或 refinement 时，可以使用 `loop until`：

```agentscript
loop until ready max 2 {
    attempts += 1
    verdict = check(input.goal, classified, attempts)
    ready = verdict.ready
}
```

这个循环依然有边界。如果 `ready` 一直不是 true，最多执行两次。

## 5. 运行

用 mock 输出运行：

```bash
agentscript tutorials/control-flow.as --mock --input '{"goal":"Triage support requests","items":[{"title":"Checkout is down","urgent":true},{"title":"Rename workspace","urgent":false}]}'
```

打印 trace，可以看到 `for`、`parallel for` 和 `loop until` 事件：

```bash
agentscript tutorials/control-flow.as --mock --trace --input '{"goal":"Triage support requests","items":[{"title":"Checkout is down","urgent":true},{"title":"Rename workspace","urgent":false}]}'
```

## 下一步

下一种模式是计划与执行。它会继续使用这些概念，只是把批处理 item 换成 planned steps。
