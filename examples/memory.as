import llm Qwen from "ollama://localhost:11434/qwen3.6"
import memory Lessons from "file://./.agentscript/example-lessons.jsonl"

main agent MemoryExample {
    model Qwen
    role "Reflective Assistant"
    description "Demonstrate querying and writing explicit memory."

    main func(input {
        topic string
    }) {
        past = Lessons.query({
            text: input.topic,
            limit: 3
        })
        use input.topic
        use past max 1k as "relevant lessons"

        answer = generate({ input: "Answer using relevant lessons", max_output: 500 }) -> {
            response
            lesson
        }

        Lessons.add({
            topic: input.topic,
            text: answer.lesson
        })

        answer
    }
}
