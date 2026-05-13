import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent Triage {
    model Qwen
    role "Support triage"
    description "Classify a support request with explicit selectable context policy."

    main func(input {
        request: string
    }) {
        use one of {
            concise: "Use a concise one-paragraph triage style." selected
            detailed: "Use a detailed triage style with rationale and next steps."
        } as style

        use input.request as "support request"

        generate({ input: "Triage the support request", max_output: 500 }) -> {
            priority
            summary
            next_steps: list[string]
        }
    }
}
