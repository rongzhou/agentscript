import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent Coordinator {
    model Qwen
    role "Coordinator"
    description "Route a small writing task through specialist agents."

    main func(input {
        topic: string
        audience: string
    }) {
        research = Researcher({
            topic: input.topic
        })

        draft = Writer({
            topic: input.topic,
            audience: input.audience,
            research: research
        })

        review = Reviewer({
            topic: input.topic,
            audience: input.audience,
            draft: draft
        })

        {
            research: research,
            draft: draft,
            review: review
        }
    }
}

agent Researcher {
    model Qwen
    role "Researcher"
    description "Extract a few useful facts for a topic."

    main func(input {
        topic: string
    }) {
        use input.topic as "topic"

        generate({ input: "List a few useful facts for this topic", max_output: 500 }) -> {
            facts: list[string]
            angle
        }
    }
}

agent Writer {
    model Qwen
    role "Writer"
    description "Draft a short answer for a specific audience."

    main func(input {
        topic: string
        audience: string
        research: json
    }) {
        use input.topic as "topic"
        use input.audience as "audience"
        use input.research.facts max 1k as "research facts"

        generate({ input: "Write a concise draft", max_output: 600 }) -> {
            title
            body
        }
    }
}

agent Reviewer {
    model Qwen
    role "Reviewer"
    description "Review whether a draft fits the topic and audience."

    main func(input {
        topic: string
        audience: string
        draft: json
    }) {
        use input.topic as "topic"
        use input.audience as "audience"
        use input.draft as "draft"

        generate({ input: "Review the draft and suggest improvements", max_output: 500 }) -> {
            ok: boolean
            notes: list[string]
        }
    }
}
