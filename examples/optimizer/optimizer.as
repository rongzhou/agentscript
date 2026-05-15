import tool Optimizer from "host://optimizer"

main agent OptimizerAgent {
    main func(input {
        target: string
        request: string
        selection: json
        write: string
        trial_trace: string
        output: string
        dry_run: boolean
    }) {
        inspected = Optimizer.inspect({
            target: input.target
        })

        trial = Optimizer.trial({
            target: input.target,
            input: {
                request: input.request
            },
            selection: input.selection,
            trace: input.trial_trace
        })

        write_mode = input.write
        if input.dry_run {
            write_mode = "preview"
        }

        specialized = Optimizer.specialize({
            target: input.target,
            selection: input.selection,
            write: write_mode,
            output: input.output
        })

        {
            inspected: inspected,
            trial: trial,
            specialized: specialized
        }
    }
}
