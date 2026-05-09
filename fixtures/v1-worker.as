agent Worker {
    main func(input) {
        {
            id: input.step.id,
            task: input.step.task,
            goal: input.goal
        }
    }
}
