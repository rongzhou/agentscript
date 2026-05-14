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
