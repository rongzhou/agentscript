import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Find from "sh://find"
import tool Grep from "sh://grep"
import tool Sed from "sh://sed"

main agent RepoReviewAssistant {
    model Qwen
    role "Release Readiness Reviewer"
    description "Review a repository for release readiness using explicit, bounded context."

    main func(input {
        path string
    }) {
        files = Find.run({
            path: input.path,
            type: "file",
            max: 200
        })
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
        package_metadata = Sed.run({
            path: "package.json",
            start: 1,
            max: 120
        })
        ci_config = Sed.run({
            path: ".github/workflows/ci.yml",
            start: 1,
            max: 120
        })

        use input.path as "repository path"
        use files max 8k as "file tree"
        use todos max 4k as "todo findings"
        use fixmes max 4k as "fixme findings"
        use package_metadata max 4k as "package metadata"
        use ci_config max 4k as "ci configuration"

        generate({ input: "Review this repository for release readiness", max_output: 4k, strict: true, think: "medium" }) -> {
            summary string
            blockers list[string]
            risks list[string]
            quick_wins list[string]
            next_steps list[string]
        }
    }
}
