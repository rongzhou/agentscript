import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent UseContextExample {
    model Qwen
    role "Answerer"
    description "Answer using only explicitly selected context."

    main func(input {
        question string
        docs json
    }) {
        use input.question as "user question"
        use input.docs.summary max 2k as evidence

        generate({ input: "Answer from the selected evidence", max_output: 500 }) -> {
            answer
            citations list[string]
        }
    }
}
