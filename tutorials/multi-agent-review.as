import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent ReviewCoordinator {
    model Qwen
    role "Review coordinator"
    description "Run parallel specialist reviews and consolidate the feedback."

    main func(input {
        draft: string
        audience: string
    }) {
        review_plan = Planner({
            audience: input.audience
        })

        reviewers = [
            {
                name: "clarity",
                focus: review_plan.clarity_focus
            },
            {
                name: "accuracy",
                focus: review_plan.accuracy_focus
            },
            {
                name: "usefulness",
                focus: review_plan.usefulness_focus
            }
        ]

        reviews = parallel for reviewer in reviewers max 3 {
            Reviewer({
                draft: input.draft,
                audience: input.audience,
                reviewer: reviewer
            })
        }

        Editor({
            draft: input.draft,
            audience: input.audience,
            reviews: reviews
        })
    }
}

agent Planner {
    model Qwen
    role "Review planner"
    description "Choose review focuses for a target audience."

    main func(input {
        audience: string
    }) {
        use input.audience as "audience"

        generate({ input: "Create three review focuses for this audience", max_output: 400 }) -> {
            clarity_focus
            accuracy_focus
            usefulness_focus
        }
    }
}

agent Reviewer {
    model Qwen
    role "Specialist reviewer"
    description "Review a draft from one focused perspective."

    main func(input {
        draft: string
        audience: string
        reviewer: json
    }) {
        use input.audience as "audience"
        use input.reviewer as "review focus"
        use input.draft max 2k as "draft"

        generate({ input: "Review the draft from this focus", max_output: 500 }) -> {
            reviewer
            strengths: list[string]
            issues: list[string]
            recommendation
        }
    }
}

agent Editor {
    model Qwen
    role "Editor"
    description "Merge specialist reviews into final editorial guidance."

    main func(input {
        draft: string
        audience: string
        reviews: list[json]
    }) {
        use input.audience as "audience"
        use input.draft max 2k as "draft"
        use input.reviews.summary max 3k as "specialist reviews"

        generate({ input: "Create final revision guidance from the reviews", max_output: 700 }) -> {
            summary
            priority_fixes: list[string]
            ready_to_publish: boolean
        }
    }
}
