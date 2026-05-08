import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool File from "file://workspace"

main agent FileSummarizer {
    model Qwen
    role "Technical Writer"
    description "Read one local file and produce a useful structured summary."

    main func(input {
        path string
    }) {
        content = File.read({
            path: input.path
        })

        use input.path
        use content < 8k

        return generate({ input: "Summarize the file for a busy teammate", limit: 1000 }) {
            return {
                title string
                summary string
                key_points list[string]
                action_items list[string]
            }
        }
    }
}
