import memory Notes from "file://./.agentscript/tutorial-memory.jsonl"

main agent MemoryDemo {
    main func(input {
        topic: string
    }) {
        Notes.add({
            kind: "note",
            text: input.topic,
            topic: input.topic
        })

        Notes.query({
            kind: "note",
            text: input.topic,
            limit: 3
        })
    }
}
