import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent PlanExecuteExample {
    model Qwen
    role "Planner"
    description "Demonstrate planning and bounded step execution."

    main func(input {
        goal string
    }) {
        plan = [
            { step: "collect context" },
            { step: "draft answer" },
            { step: "check result" }
        ]
        results = parallel for item in plan max 3 {
            run_step(input.goal, item.step)
        }

        use input.goal as goal
        use results.summary max 2k as "step results"
        generate({ input: "Write the final answer from the executed steps", max_output: 600 }) -> {
            answer string
            completed_steps list[string]
        }
    }

    func run_step(goal, step) {
        use goal
        use step
        generate({ input: "Execute this single plan step", max_output: 300 }) -> {
            result string
        }
    }
}
