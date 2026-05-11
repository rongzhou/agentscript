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
            at_least_start: total >= start,
            within_limit: total <= 10,
            doubled: total * 2,
            average: total / 2,
            delta: total - start
        }
    }
}
