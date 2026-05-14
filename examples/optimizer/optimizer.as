import tool AgentScript from "host://agentscript"

main agent Optimizer {
    main func(input {
        target: string
        request: string
        selection: json
        write: string
        trial_trace: string
        output: string
        dry_run: boolean
    }) {
        inspected = AgentScript.inspect({
            target: input.target
        })

        trial = AgentScript.trial({
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

        specialized = AgentScript.specialize({
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
