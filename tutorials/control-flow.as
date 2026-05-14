import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent ControlFlowExample {
    model Qwen
    role "Batch coordinator"
    description "Classify a small batch, process independent items in parallel, and summarize the result."

    main func(input {
        goal: string
        items: list[json]
    }) {
        urgent = []
        regular = []

        for item in input.items max 10 {
            if item.urgent {
                urgent.add(item)
            } else {
                regular.add(item)
            }
        }

        classified = parallel for item in input.items max 5 {
            classify(input.goal, item)
        }

        ready = false
        attempts = 0
        verdict = {
            ready: false,
            note: "not checked yet"
        }

        loop until ready max 2 {
            attempts += 1
            verdict = check(input.goal, classified, attempts)
            ready = verdict.ready
        }

        finish(input.goal, urgent, regular, classified, verdict, attempts)
    }

    func classify(goal, item) {
        use goal as "batch goal"
        use item as "item"

        generate({ input: "Classify this item for the batch goal", max_output: 300 }) -> {
            label
            reason
        }
    }

    func check(goal, classified, attempts) {
        use goal as "batch goal"
        use classified.summary max 2k as "classified items"
        use attempts as "attempt"

        generate({ input: "Decide whether the batch is ready to summarize", max_output: 300 }) -> {
            ready: boolean
            note
        }
    }

    func finish(goal, urgent, regular, classified, verdict, attempts) {
        use goal as "batch goal"
        use urgent.summary max 1k as "urgent items"
        use regular.summary max 1k as "regular items"
        use classified.summary max 2k as "classified items"
        use verdict as "readiness verdict"
        use attempts as "attempts"

        generate({ input: "Summarize the batch result", max_output: 600 }) -> {
            summary
            urgent_count: number
            regular_count: number
            ready: boolean
        }
    }
}
