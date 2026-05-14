import file Plan from "./regression-multifile-data.json"
import agent Worker from "./regression-multifile-worker.as"

main agent RegressionMultifile {
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
