# 记忆与反思

Memory 让 agent 能在多次运行之间保留有用信息。Reflection 则是在一次运行结束后，判断什么经验值得保存。

这篇教程构建一个简单循环：

1. 查询相关历史 lesson。
2. 使用这些 lesson 回答当前目标。
3. 对本次运行做 reflection。
4. 保存一条新的 lesson。

<img src="/img/tutorial-9.png" alt="记忆与反思教程概览" width="900" />

完整源码：[`../../../tutorials/memory-reflection.as`](https://github.com/rongzhou/agentscript/blob/main/tutorials/memory-reflection.as)

## 1. 完整程序

创建 `memory-reflection.as`，或者直接打开仓库里的 `tutorials/memory-reflection.as`：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import memory Lessons from "file://./.agentscript/tutorial-lessons.jsonl"

main agent MemoryReflection {
    model Qwen
    role "Reflective assistant"
    description "Use relevant lessons, answer a goal, then store one new lesson."

    main func(input {
        goal: string
    }) {
        past = Lessons.query({
            kind: "lesson",
            text: input.goal,
            limit: 5
        })

        result = answer(input.goal, past)
        lesson = reflect(input.goal, result, past)

        Lessons.add({
            kind: "lesson",
            text: lesson.insight,
            goal: input.goal,
            ok: result.ok
        })

        {
            result: result,
            learned: lesson.insight
        }
    }

    func answer(goal, past) {
        use goal as "goal"
        use past.summary max 2k as "relevant past lessons"

        generate({ input: "Answer the goal using any relevant lessons", max_output: 700 }) -> {
            ok: boolean
            answer
            reason
        }
    }

    func reflect(goal, result, past) {
        use goal as "goal"
        use result as "current result"
        use past.summary max 2k as "past lessons"

        generate({ input: "Extract one durable lesson for future runs", max_output: 300 }) -> {
            insight
        }
    }
}
```

## 2. 导入 Memory

Memory 是显式声明的运行时能力：

```agentscript
import memory Lessons from "file://./.agentscript/tutorial-lessons.jsonl"
```

这个例子使用 file memory，会把 JSONL 记录保存在 `.agentscript/` 下。这个文件是普通项目数据，不是 prompt context。

## 3. 查询历史 Lesson

第一步是搜索相关 lesson：

```agentscript
past = Lessons.query({
    kind: "lesson",
    text: input.goal,
    limit: 5
})
```

查询 memory 只是把数据返回给程序。它不会自动把这些数据展示给模型。

## 4. 选择模型能看到什么

`answer` 函数显式选择 goal 和有边界的历史 lesson 摘要：

```agentscript
use goal as "goal"
use past.summary max 2k as "relevant past lessons"
```

这和之前的上下文规则一致：memory record 只是普通数据，除非你用 `use` 选择它。

## 5. Reflect 并保存一条 Lesson

回答之后，agent 会问一个更小的 reflection 问题：

```agentscript
lesson = reflect(input.goal, result, past)
```

然后保存一条可复用的 lesson：

```agentscript
Lessons.add({
    kind: "lesson",
    text: lesson.insight,
    goal: input.goal,
    ok: result.ok
})
```

这里重要的习惯是：保存紧凑 lesson，而不是保存整段 transcript。

## 6. 运行

用 mock 模型输出运行：

```bash
agentscript tutorials/memory-reflection.as --mock --input '{"goal":"Explain explicit context boundaries"}'
```

用相同 goal 运行两次。第二次运行就可以查询到第一次保存的 lesson。

如果想检查流程而不调用真实模型，可以打印 trace：

```bash
agentscript tutorials/memory-reflection.as --mock --trace --input '{"goal":"Explain explicit context boundaries"}'
```

## 下一步

Memory 引入了长期状态。下一个高级主题是 optimization：使用 `use one of` 和 optimizer toolchain 对比不同 context 选择。
