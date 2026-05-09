main agent ArithmeticExample {
    main func(input) {
        start = 4
        total = start
        total += 5
        total -= 2

        label = "total:"
        label += total

        {
            total: total,
            label: label,
            above_five: total > 5,
            delta: total - start
        }
    }
}
