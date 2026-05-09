main agent {
    role "Assistant"
    description "Return a simple hello world response."

    main func(input {}) {
        {
            ok: true,
            message: "Hello, AgentScript!"
        }
    }
}
