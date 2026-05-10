# AgentScript Final Expression Return

本文档描述 AgentScript 函数的隐式返回规则。

## 1. 基本规则

函数体最后一个顶层表达式可以作为函数返回值。

```agentscript
func answer(input) {
    use input.question

    generate({ input: "Answer the question" }) -> {
        ok boolean
        answer
    }
}
```

等价于：

```agentscript
func answer(input) {
    use input.question

    return generate({ input: "Answer the question" }) -> {
        ok boolean
        answer
    }
}
```

这个规则称为：

```text
final expression return
```

## 2. 可隐式返回的表达式

允许最后一行隐式返回以下表达式形式：

```text
generate(...) -> shape
普通函数调用
agent 调用
变量引用
字段访问
索引访问
对象字面量
列表字面量
```

例如：

```agentscript
func run(input) {
    Worker(input)
}
```

这条规则适用于所有表达式形式，包括调用表达式。被调用者解析为本地函数还是 agent 调用，都不影响 final expression return。例如，直接用 agent 名称调用另一个 agent 时，会调用该 agent 的 `main func`，其结果会被隐式返回：

```agentscript
agent Planner {
    main func(input) {
        generate({ input: "Create a plan" }) -> {
            steps list[string]
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

## 3. 不可隐式返回的语句

下面这些不是表达式，不参与隐式返回：

```text
use 声明
赋值语句
import
loop
repeat
for
if/else，早期版本可先不表达式化
```

例如：

```agentscript
func bad(input) {
    use input.question
}
```

这里没有返回表达式，函数返回 `none`，或由 semantic analyzer 给出 warning。

赋值也不返回：

```agentscript
func f() {
    x = answer()
}
```

如果要返回，需要写：

```agentscript
func f() {
    x = answer()
    x
}
```

## 4. 显式 `return` 优先

显式 `return` 仍然合法，并且在复杂控制流中推荐使用。

```agentscript
func answer(input) {
    if input.dry_run {
        return {
            ok: false,
            answer: "dry run"
        }
    }

    generate({ input: "Answer" }) -> {
        ok boolean
        answer
    }
}
```

## 5. 无返回值

如果函数没有显式 `return`，最后一行也不是可返回表达式，则返回：

```agentscript
none
```

可以显式写：

```agentscript
return none
```

用于表达“此函数只产生副作用”。

## 6. 推荐风格

对于典型 LLM 调用，推荐省略 `return`：

```agentscript
func summarize(content) {
    use content max 8k

    generate({
        input: "Summarize the content",
        max_output: 1000
    }) -> {
        title
        summary
        key_points list[string]
    }
}
```

对于分支、提前退出、错误处理，推荐使用显式 `return`：

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
        ok boolean
        answer
    }
}
```

## 一句话定义

```text
A function returns the value of its final top-level expression when no explicit return is reached.
```
