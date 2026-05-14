import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent HelloAgent {
    model Qwen
    role "Helpful assistant"
    description "Turn one short request into a friendly structured answer."

    main func(input {
        name: string
        request: string
    }) {
        use input.name as "user name"
        use input.request as "user request"

        generate({ input: "Write a friendly response", max_output: 300 }) -> {
            greeting
            answer
            next_steps: list[string]
        }
    }
}
