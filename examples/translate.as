import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Find from "sh://find"

main agent MarkdownTranslator {
    model Qwen
    role "Documentation Translator"
    description "Find markdown files and prepare a batch translation plan."

    main func(input {
        path string
        target_language string
    }) {
        files = Find.run({
            path: input.path,
            name: "*.md",
            type: "file",
            max: 50
        })

        use input.path
        use input.target_language
        use files < 4k

        return generate({ input: "Create a practical markdown translation plan", limit: 1000 }) -> {
            target_language string
            files list[string]
            glossary_notes list[string]
            instructions string
        }
    }
}
