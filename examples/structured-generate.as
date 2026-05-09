import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent StructuredGenerateExample {
    model Qwen
    role "Classifier"
    description "Classify one short request into a structured result."

    main func(input {
        request string
    }) {
        generate({ input: "Classify the user request", max_output: 300 }) -> {
            category string
            priority string
            summary string
        }
    }
}
