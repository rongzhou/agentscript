import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent {
    model Qwen
    role "CLI Assistant"
    description "Answer a short request from a command-line user."

    main func(input {
        name: string
        request: string
    }) {
        use input.name
        use input.request

        generate({ input: "Reply to the CLI user by name", max_output: 300 }) -> {
            ok: boolean
            message
        }
    }
}
