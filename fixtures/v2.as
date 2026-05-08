import llm Qwen from "ollama://localhost:11434/qwen3.6"
import memory Lessons from "file://./.agentscript/lessons.jsonl"

main agent Learner {
    model Qwen
    role "Learning Agent"
    description "Use explicit memory to improve future answers."

    main func(input {
        goal string
    }) {
        past = Lessons.query({
            text: input.goal
            kind: "lesson"
            limit: 5
        })

        use input.goal
        use past < 2k

        answer = generate({
            input: "Answer the goal using relevant past lessons.",
            attempts: 2
        }) -> {
            ok boolean
            answer string
            reason string
        }

        reflection = reflect({
            goal: input.goal
            answer: answer
        })

        Lessons.add({
            kind: "lesson"
            text: reflection.insight
            goal: input.goal
            ok: answer.ok
        })

        return {
            ok: answer.ok
            answer: answer.answer
            lessons: past.length
        }
    }

    func reflect(run) {
        use run

        return generate({
            input: "Extract one reusable lesson from this run.",
            attempts: 2
        }) -> {
            insight string
        }
    }
}
