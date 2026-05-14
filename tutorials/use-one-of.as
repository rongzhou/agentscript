import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent ContextChoice {
    model Qwen
    role "Support triage assistant"
    description "Show how one context slot can expose alternative context policies."

    main func(input {
        request: string
        customer_tier: string
    }) {
        policy = {
            concise: "Use a short answer for routine requests.",
            detailed: "Explain reasoning and give concrete next steps.",
            vip: "Prioritize escalation paths and account impact."
        }

        use input.request as "support request"

        use one of {
            concise: policy.concise selected
            detailed: policy.detailed
            vip: policy.vip
            none: empty
        } as "response policy"

        use input.customer_tier as "customer tier"

        generate({ input: "Triage the support request", max_output: 500 }) -> {
            priority
            summary
            next_steps: list[string]
        }
    }
}
