main agent ReplGuide {
    role "REPL Guide"
    description "Show a small AgentScript program that can be loaded and run in the REPL."

    main func(input {}) {
        commands = [
            {
                command: ":load examples/repl.as",
                purpose: "Load this teaching agent into the REPL session."
            },
            {
                command: ":check",
                purpose: "Parse and semantically check the current REPL program."
            },
            {
                command: ":run {}",
                purpose: "Run the main agent with an empty JSON input."
            },
            {
                command: ":trace pretty",
                purpose: "Print the latest run trace in a readable form."
            }
        ]

        {
            ok: true,
            title: "AgentScript REPL quick start",
            commands: commands
        }
    }
}
