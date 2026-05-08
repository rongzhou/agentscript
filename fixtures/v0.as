import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Search from "mcp://tools/search"

main agent ResearchAgent {
    model Qwen
    role "Researcher"
    description "Answer questions with a small reason-act-observe loop."

    main func(input {
        question string
    }) {
        use input.question

        scratch = []
        use scratch.summary < 2k

        done = false

        loop until done < 4 {
            thought = reason(input.question, scratch)
            action = act(input.question, thought)
            observation = observe(action)

            scratch.add(observation)
            done = enough(input.question, scratch)
        }

        return answer(input.question, scratch)
    }

    func reason(question, scratch) {
        use question
        use scratch.summary < 1k

        return generate({ input: "Choose the next search focus", limit: 300 }) {
            return {
                focus string
                why string
            }
        }
    }

    func act(question, thought) {
        raw_query = Search.query(question, thought)
        raw_result = Search.search(raw_query)

        return {
            query: raw_query.summary,
            result: {
                summary: raw_result.summary,
                source: raw_result.source
            }
        }
    }

    func observe(action) {
        raw = {
            query: action.query,
            summary: action.result.summary,
            source: action.result.source
        }

        use raw

        return generate({ input: "Summarize the useful observation", limit: 400 }) {
            return {
                facts list[string]
                source string
            }
        }
    }

    func enough(question, scratch) {
        use question
        use scratch.summary < 1k

        verdict = generate({ input: "Decide whether the observations are enough", limit: 200 }) {
            return {
                done boolean
            }
        }

        return verdict.done
    }

    func answer(question, scratch) {
        use question
        use scratch.summary < 2k

        return generate({ input: "Answer using only the observations", limit: 800 }) {
            return {
                ok boolean
                text string
                error string
            }
        }
    }
}
