import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool File from "file://workspace"

main agent ChangelogWriter {
    model Qwen
    role "Release Manager"
    description "Read a git diff saved to a file and generate a release changelog draft."

    main func(input {
        diff_path string
    }) {
        diff = File.read({
            path: input.diff_path
        })

        use input.diff_path as "diff path"
        use diff max 10k as "git diff"

        generate({ input: "Write a changelog from this git diff", max_output: 1200 }) -> {
            title
            highlights list[string]
            breaking_changes list[string]
            fixes list[string]
            notes
        }
    }
}
