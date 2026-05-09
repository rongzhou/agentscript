import llm Qwen from "ollama://localhost:11434/qwen3.6"
import memory Lessons from "file://./.agentscript/self-improve-lessons.jsonl"

main agent SelfImprover {
    model Qwen
    role "Self-improving assistant"
    description "Read relevant lessons, answer the goal, then store a new lesson."

    main func(input {
        goal string
    }) {
        past = Lessons.query({
            kind: "lesson"
            text: input.goal
            limit: 5
        })

        use input.goal
        use past < 2k

        result = generate({
            input: "Answer the goal using any relevant lessons.",
            attempts: 3
        }) -> {
            ok boolean
            answer string
            reason string
        }

        lesson = reflect({
            goal: input.goal
            result: result
            past: past
        })

        Lessons.add({
            kind: "lesson"
            text: lesson.insight
            goal: input.goal
            ok: result.ok
        })

        result
    }

    func reflect(run) {
        use run

        generate({
            input: "Extract one durable lesson that could improve a future run.",
            attempts: 3
        }) -> {
            insight string
        }
    }
}
