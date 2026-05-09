# AgentScript Context Engineering

本文档是 AgentScript context engineering 的总纲。它说明 AgentScript 为什么存在、必须维护哪些边界，以及 `use ... as ...` 和 `generate` 两篇细化文档如何配合。

AgentScript 有变量、函数、循环、工具、memory 和 Agent 调用，但它的目标不是成为通用编程语言，而是让 prompt context 显式、作用域化、类型化、可追踪、可审计。

## 文档结构

Context engineering 设计拆成三篇：

- **Context Engineering**：本文，总览核心模型和不变量。
- **[`use ... as ...`](./use-as.md)**：说明如何选择数据作为 prompt context，label 如何工作，budget 如何应用，以及 scope 如何影响可见性。
- **[`generate`](./generate.md)**：说明 generation site、prompt 构造、agent identity、输出契约、预算、重试和 trace。

语言参考仍然是紧凑语法说明；这些设计文档定义语义边界。

## 核心模型

AgentScript 的控制流服务于 prompt context 构建。

普通语句负责组织数据、调用工具、调用 Agent、查询 memory 和更新中间状态。LLM 调用只能通过 `generate(...) -> { ... }` 发生。一次 `generate` 只能看到由 `use` 显式声明、且在作用域中可见的 context source。

AgentScript 的核心对象是：

- **Data**：普通值，例如 input、JSON、list、文件内容、工具 observation、memory 查询结果和 Agent 返回值。
- **Context source**：通过 `use expr` 选择进入 prompt context 的数据，可带 budget 和 label。
- **Generation site**：一次由 `generate({ input, max_output, attempts, temperature, think, strict, debug }) -> shape` 表示的 LLM 调用。
- **Boundary**：由 Agent、function 或 block scope 形成的可见性边界。
- **Trace**：解释哪些 source 被选择、prompt context 如何构建、每次 generation 返回了什么的审计记录。

## 核心不变量

AgentScript 应维护这些不变量：

- **不隐式捕获**：局部变量、工具输出、memory 记录和 trace 事件不会自动进入 prompt，除非被 `use` 选择。
- **作用域可见性**：context 可见性遵循 scope。子作用域可继承父作用域 context；function 和 Agent 调用创建独立 context boundary。
- **能力隔离**：imported tool、model、agent、memory handle、function、provider URI 和 runtime 配置是能力，不是 prompt data。
- **延迟解析 context**：`use expr` 声明 source，值在可见的 `generate` 构建 prompt 时解析。
- **prompt 分层**：prompt 区分 agent identity、selected context、instruction 和 output contract。
- **trace 可审计**：trace 必须解释 LLM 调用实际看到了什么，包括 source expression、label、budget、clipping 和结果。

## 边界模型

### Function boundary

每次函数调用都有自己的 context boundary。callee 不会自动继承 caller 已选择的 context。数据必须作为参数传入，并在 callee 需要放进自己的 prompt 时再次 `use`。

```agentscript
func caller(input) {
    use input.goal as goal
    helper(input)
}

func helper(input) {
    use input.detail as detail
    generate({ input: "Work on detail" }) -> {
        ok boolean
    }
}
```

`helper` 内的 `generate` 看到的是 `input.detail`，不是 `caller` 的 `input.goal`。

### Agent boundary

Agent 调用形成更强的边界。被调用 Agent 不会看到 caller 的 prompt context，只会看到输入值和它自己的函数显式选择的 context。

```agentscript
result = Worker({
    goal: input.goal,
    previous: results.summary
})
```

这让 multi-agent 组合保持可审计：每个 Agent 都有自己的 prompt contract。

### Block boundary

`if`、`repeat`、`loop`、`for` 等 block 创建子作用域。block 内声明的 context 影响 block 内的 `generate`，不会向外泄漏。

## Prompt 层次

一次 `generate` 的 prompt 由四个概念层组成：

1. **Agent identity**：当前 Agent 的 `role`、`description` 和稳定身份。
2. **Selected context**：可见的 `use` 声明，渲染时带 source、label、value 和 budget 信息。
3. **Instruction**：来自 `generate({ input: ... })` 的本次任务。
4. **Output contract**：可选的 `-> { ... }` shape。

详细构造规则见 [`generate`](./generate.md)。

## 设计检查清单

修改 `use`、scope、context builder、trace 或 LLM provider 行为前，应检查：

- 是否让未 `use` 的数据进入 prompt？
- 是否让 caller context 污染 callee？
- 是否把 tool/model/agent/function binding 当作 prompt data 暴露？
- 是否保留 source、label、budget 和 clipping 信息用于审计？
- 是否把 `use` 退化成快照赋值，而不是延迟 context source？
- 是否混淆 context budget 和 generation budget？
- 是否混淆 AgentScript context label 和 provider message role？

AgentScript 的核心价值不是多一种控制流语法，而是让 prompt context 的来源、范围、预算、身份和最终 prompt 形态显式且稳定。
