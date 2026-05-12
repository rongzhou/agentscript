# AgentScript Final Expression Return

This document describes the implicit return rule for AgentScript functions.

## 1. Basic rule

The final top-level expression in a function body can be used as the function return value.

```agentscript
func answer(input) {
    use input.question

    generate({ input: "Answer the question" }) -> {
        ok: boolean
        answer
    }
}
```

This is equivalent to:

```agentscript
func answer(input) {
    use input.question

    return generate({ input: "Answer the question" }) -> {
        ok: boolean
        answer
    }
}
```

This rule is called:

```text
final expression return
```

## 2. Expressions that can be implicitly returned

The final line can implicitly return these expression forms:

```text
generate(...) -> contract
regular function call
agent call
variable reference
field access
index access
object literal
list literal
```

Examples:

```agentscript
func run(input) {
    Worker(input)
}
```

This rule applies to all expression forms, including calls. It does not matter whether the callee resolves to a local function or an agent call. For example, calling another agent by name invokes that agent's `main func`, and the result is returned implicitly:

```agentscript
agent Planner {
    main func(input) {
        generate({ input: "Create a plan" }) -> {
            steps: list[string]
        }
    }
}

agent Controller {
    func run(input) {
        Planner(input)
    }
}
```

```agentscript
func get_result(result) {
    result.value
}
```

```agentscript
func observe(action) {
    {
        facts: [action.summary],
        source: action.source
    }
}
```

## 3. Statements that cannot be implicitly returned

The following constructs are not expressions and do not participate in final expression return:

```text
use declaration
assignment statement
import
loop
repeat
for
if/else, which can remain non-expression syntax in early versions
```

Example:

```agentscript
func bad(input) {
    use input.question
}
```

This function has no return expression. It returns `none`, or the semantic analyzer may report a warning.

Assignment also does not return a value:

```agentscript
func f() {
    x = answer()
}
```

To return the assigned value, write:

```agentscript
func f() {
    x = answer()
    x
}
```

## 4. Explicit `return` takes priority

Explicit `return` remains valid and is recommended for complex control flow.

```agentscript
func answer(input) {
    if input.dry_run {
        return {
            ok: false,
            answer: "dry run"
        }
    }

    generate({ input: "Answer" }) -> {
        ok: boolean
        answer
    }
}
```

## 5. No return value

If a function has no explicit `return` and its final line is not a returnable expression, it returns:

```agentscript
none
```

This can also be written explicitly:

```agentscript
return none
```

Use this form to express that a function only produces side effects.

## 6. Recommended style

For typical LLM calls, omit `return`:

```agentscript
func summarize(content) {
    use content max 8k

    generate({
        input: "Summarize the content",
        max_output: 1000
    }) -> {
        title
        summary
        key_points: list[string]
    }
}
```

For branches, early exits, and error handling, use explicit `return`:

```agentscript
func answer(input) {
    if not input.question {
        return {
            ok: false,
            answer: ""
        }
    }

    use input.question

    generate({ input: "Answer the question" }) -> {
        ok: boolean
        answer
    }
}
```

## One-sentence definition

```text
A function returns the value of its final top-level expression when no explicit return is reached.
```
