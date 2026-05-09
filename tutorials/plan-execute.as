import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Search from "mcp://tools/search"

main agent PlanAndExecute {
    model Qwen
    role "Controller"
    description "Coordinate planning, execution, verification, and final synthesis."

    main func(input {
        goal string
    }) {
        plan = Planner({
            goal: input.goal,
            problem: "",
            previous: []
        })
        results = []

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

        for step in steps max 6 {
            outcome = run_step(input.goal, step, results)
            results.add(outcome.result)

            if not outcome.ok {
                plan = Planner({
                    goal: input.goal,
                    problem: outcome.reason,
                    previous: results.summary
                })
            }
        }

        finish(input.goal, results)
    }

    func run_step(goal, step, previous) {
        result = Executor({
            goal: goal,
            step: step,
            previous: previous.summary
        })

        verdict = Verifier({
            goal: goal,
            step: step,
            result: result
        })

        {
            ok: verdict.ok,
            reason: verdict.reason,
            result: {
                step: step.id,
                task: step.task,
                output: result.output
            }
        }
    }

    func finish(goal, results) {
        use goal
        use results.summary max 2k

        generate({ input: "Create the final answer from executed steps", max_output: 800 }) -> {
            ok boolean
            text string
            error string
        }
    }
}

agent Planner {
    model Qwen
    role "Planner"
    description "Create or revise a short executable plan."

    main func(input) {
        use input.goal
        use input.problem
        use input.previous max 1k

        generate({ input: "Create a three step plan", max_output: 600 }) -> {
            step1 string
            step2 string
            step3 string
        }
    }
}

agent Executor {
    model Qwen
    role "Executor"
    description "Execute one plan step with available tools."

    main func(input) {
        use input.goal
        use input.step
        use input.previous max 1k

        query = Search.query(input.goal, input.step, input.previous)
        raw = Search.search(query)

        observation = {
            summary: raw.summary,
            source: raw.source
        }

        use observation

        generate({ input: "Report the result of this step", max_output: 500 }) -> {
            ok boolean
            output json
            error string
        }
    }
}

agent Verifier {
    model Qwen
    role "Verifier"
    description "Check whether one executed step satisfies the plan."

    main func(input) {
        use input.goal
        use input.step
        use input.result

        generate({ input: "Verify this step result", max_output: 300 }) -> {
            ok boolean
            reason string
        }
    }
}
