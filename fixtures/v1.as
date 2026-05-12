import file Plan from "./v1-data.json"
import agent Worker from "./v1-worker.as"

main agent V1Regression {
    main func(input {
        goal: string
    }) {
        results = []

        for step in Plan.steps max 4 {
            results.add(Worker({
                goal: input.goal,
                step: step
            }))
        }

        {
            ok: true,
            first: results[0].id,
            count: results.length,
            results: results.summary
        }
    }
}
