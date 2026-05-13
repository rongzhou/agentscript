import tool AgentScript from "host://agentscript"

main agent Optimizer {
    main func(input {
        target: string
        request: string
        selection: json
        write: string
        trial_trace: string
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

        specialized = AgentScript.specialize({
            target: input.target,
            selection: input.selection,
            write: input.write
        })

        {
            inspected: inspected,
            trial: trial,
            specialized: specialized
        }
    }
}
