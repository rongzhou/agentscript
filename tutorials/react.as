import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Env from "env://process"

main agent BasicReAct {
    model Qwen
    role "Diagnostic assistant"
    description "Answer one question with a minimal Reason-Act-Observe flow."

    main func(input {
        question: string
    }) {
        env_name = "USER"
        thought = reason(input.question, env_name)
        action = Env.get({
            name: env_name
        })
        observation = observe(input.question, env_name, action)

        answer(input.question, thought, observation)
    }

    func reason(question, env_name) {
        use question as "question"
        use env_name as "planned tool input"

        generate({ input: "Explain why this environment variable may help answer the question", max_output: 300 }) -> {
            why
        }
    }

    func observe(question, env_name, action) {
        use question as "question"
        use env_name as "environment variable"
        use action.value as "environment value"

        generate({ input: "Turn the tool result into a useful observation", max_output: 400 }) -> {
            facts: list[string]
            value_found: boolean
        }
    }

    func answer(question, thought, observation) {
        use question as "question"
        use thought.why as "reasoning note"
        use observation.facts max 1k as "observed facts"
        use observation.value_found as "value found"

        generate({ input: "Answer using only the observation", max_output: 500 }) -> {
            answer
            confidence
        }
    }
}
