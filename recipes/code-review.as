import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Grep from "sh://grep"

main agent CodeReviewAssistant {
    model Qwen
    role "Senior Code Reviewer"
    description "Scan TODO and FIXME markers and return concrete review actions."

    main func(input {
        path string
    }) {
        todos = Grep.run({
            path: input.path,
            pattern: "TODO",
            include: "*",
            max: 100
        })
        fixmes = Grep.run({
            path: input.path,
            pattern: "FIXME",
            include: "*",
            max: 100
        })

        use input.path as "source path"
        use todos max 4k as "todo findings"
        use fixmes max 4k as "fixme findings"

        generate({ input: "Turn TODO and FIXME scan results into prioritized repair suggestions", max_output: 1200 }) -> {
            summary string
            findings list[string]
            suggested_fixes list[string]
            next_steps list[string]
        }
    }
}
