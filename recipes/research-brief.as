import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Search from "https://api.example.com"

main agent ResearchBriefWriter {
    model Qwen
    role "Research Analyst"
    description "Fetch a prepared search endpoint and turn the result into a concise research brief."

    main func(input {
        question string
        search_url string
    }) {
        search = Search.get({
            url: input.search_url,
            timeout: 10000
        })

        use input.question as research question
        use input.search_url as search endpoint
        use search max 8k as search results

        generate({ input: "Write a concise research brief with citations and open questions", max_output: 1200 }) -> {
            answer string
            key_points list[string]
            citations list[string]
            open_questions list[string]
        }
    }
}
