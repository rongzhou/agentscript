import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Search from "mcp://tools/search"

main agent ReActExample {
    model Qwen
    role "Research Assistant"
    description "Demonstrate a small Reason-Act-Observe loop."

    main func(input {
        question string
    }) {
        use input.question as user question
        scratch = []
        done = false

        loop until done max 2 {
            thought = reason(input.question, scratch)
            observation = Search.search(thought.query)
            scratch.add(observation)
            done = enough(input.question, scratch)
        }

        answer(input.question, scratch)
    }

    func reason(question, scratch) {
        use question
        use scratch.summary max 1k as observations
        generate({ input: "Choose one search query", max_output: 300 }) -> {
            query string
        }
    }

    func enough(question, scratch) {
        use question
        use scratch.summary max 1k as observations
        verdict = generate({ input: "Decide whether the observations are enough", max_output: 200 }) -> {
            done boolean
        }
        verdict.done
    }

    func answer(question, scratch) {
        use question
        use scratch.summary max 2k as observations
        generate({ input: "Answer using only the observations", max_output: 500 }) -> {
            answer string
            confidence string
        }
    }
}
