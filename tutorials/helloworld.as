import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent {
    model Qwen
    role "Assistant"
    description "Return a simple hello world response."

    main func(input {}) {
        {
            ok: true,
            message: "Hello, AgentScript!"
        }
    }
}
