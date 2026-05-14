import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent PlanAndExecute {
    model Qwen
    role "Project coordinator"
    description "Create a short plan, execute independent steps, and synthesize the result."

    main func(input {
        goal: string
    }) {
        plan = plan_steps(input.goal)
        steps = [
            {
                id: "step-1",
                task: plan.step1
            },
            {
                id: "step-2",
                task: plan.step2
            },
            {
                id: "step-3",
                task: plan.step3
            }
        ]

        results = parallel for step in steps max 3 {
            execute_step(input.goal, step)
        }

        synthesize(input.goal, steps, results)
    }

    func plan_steps(goal) {
        use goal as "goal"

        generate({ input: "Create a three step plan", max_output: 500 }) -> {
            step1
            step2
            step3
        }
    }

    func execute_step(goal, step) {
        use goal as "goal"
        use step as "plan step"

        generate({ input: "Execute this plan step", max_output: 400 }) -> {
            ok: boolean
            output
            risk
        }
    }

    func synthesize(goal, steps, results) {
        use goal as "goal"
        use steps.summary max 1k as "planned steps"
        use results.summary max 2k as "step results"

        generate({ input: "Synthesize the executed steps into a final answer", max_output: 700 }) -> {
            answer
            completed_steps: list[string]
            open_risks: list[string]
        }
    }
}
