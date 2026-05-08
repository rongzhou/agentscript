agent Worker {
    main func(input) {
        return {
            id: input.step.id,
            task: input.step.task,
            goal: input.goal
        }
    }
}
