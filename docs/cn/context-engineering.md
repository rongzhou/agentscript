# AgentScript Context Engineering

本文档是 AgentScript context engineering 的总纲。它说明 AgentScript 为什么存在、必须维护哪些边界，以及 `use ... as ...`、`use one of` 和 `generate` 几篇细化文档如何配合。

AgentScript 有变量、函数、循环、工具、memory 和 Agent 调用，但它的目标不是成为通用编程语言，而是让 prompt context 显式、作用域化、类型化、可追踪、可审计。

## 文档结构

Context engineering 的细化语义拆成三篇：

- **[`use ... as ...`](./use-as.md)**：说明如何选择数据作为 prompt context，label 如何工作，budget 如何应用，以及 scope 如何影响可见性。
- **[`use one of ...`](./use-one-of.md)**：说明一个 context slot 如何声明多个候选 source，`selected` 和 `empty` 如何工作，以及优化器如何把 context choice 视为结构化搜索空间。
- **[`generate`](./generate.md)**：说明 generation site、prompt 构造、agent identity、输出契约、预算、重试和 trace。

本文总览核心模型和不变量。语言参考仍然是紧凑语法说明。

## 核心模型

AgentScript 的控制流服务于 prompt context 构建。

普通语句负责组织数据、调用工具、调用 Agent、查询 memory 和更新中间状态。LLM 调用只能通过 `generate(...) -> { ... }` 发生。一次 `generate` 只能看到由 `use` 显式声明、且在作用域中可见的 context source。

AgentScript 的核心对象是：

- **Data**：普通值，例如 input、JSON、list、文件内容、工具 observation、memory 查询结果和 Agent 返回值。
- **Context source**：通过 `use expr` 选择进入 prompt context 的数据，可带 budget 和 label。
- **Context choice point**：通过 `use one of { ... }` 声明的单个 context slot。一次可见 `generate` 构建 prompt 前，它会确定性地选择一个候选 source。
- **Generation site**：一次由 `generate({ input, max_output, attempts, temperature, think, strict, debug }) -> contract` 表示的 LLM 调用。
- **Boundary**：由 Agent、function 或 block scope 形成的可见性边界。
- **Trace**：解释哪些 source 被选择、prompt context 如何构建、每次 generation 返回了什么的审计记录。

## 核心不变量

AgentScript 应维护这些不变量：

- **不隐式捕获**：局部变量、工具输出、memory 记录和 trace 事件不会自动进入 prompt，除非被 `use` 选择。
- **作用域可见性**：context 可见性遵循 scope。子作用域可继承父作用域 context；function 和 Agent 调用创建独立 context boundary。
- **能力隔离**：imported tool、model、agent、memory handle、function、provider URI 和 runtime 配置是能力，不是 prompt data。
- **延迟解析 context**：`use expr` 声明 source，值在可见的 `generate` 构建 prompt 时解析。
- **确定性 context choice**：`use one of` 在 prompt 构造前根据 trial hint、源码中的 `selected` 或源码顺序解析为一个候选。模型只看到被选中的 source，不看到候选列表。
- **确定性裁剪**：context budget 按前缀裁剪渲染值，不排序、不摘要、不做语义压缩。
- **prompt 分层**：prompt 区分 agent identity、selected context、instruction 和 output contract。
- **trace 可审计**：trace 必须解释 LLM 调用实际看到了什么，包括 source expression、label、budget、clipping 和结果。

## 声明式与执行式

AgentScript 刻意混合两种语法模式。这是它相对通用编程语言的主要取舍，也是它作为 LLM 编程 DSL 存在的主要理由。

- **声明式** 描述 agent 或 scope "是什么"：用哪个模型（`model`）、身份是谁（`role`、`description`）、默认携带什么 context（agent-level `use`）。这些是关于身份的陈述，只能出现在声明位置（agent body 顶部，或作用域级的 `use`），由 prompt builder 读取，而不是由通用解释器执行。
- **执行式** 描述 agent "做什么"：调用 tool、查询 memory、按输入分支、构造中间数据，最后通过 `generate` 发起 LLM 调用。这是出现在 function body 内的普通语句代码。

语法上，两种模式互不越界：`model` / `role` / `description` 只出现在 agent body；表达式语句只出现在 function body；`use` 在两处都允许，但语义一致——"让这个 source 进入该作用域内每一次可见 `generate` 的 prompt"。`use one of` 保持同一条边界，只是让 source 位置可选择：一个 label，多个候选 source，一个确定性选择。

两条规则把边界卡紧：

1. **声明式不执行任意代码。** agent-level `use` 的表达式只能引用 agent 顶层可解析的名字（主要是 `import file` 带入的文件），不能读 function 参数、局部变量，也不能包含 call expression。这样一个 agent 的默认 context 不用运行程序就能审计。
2. **Tool 和 memory 调用走执行式，不进 `use`。** 即使想把一次新鲜的查询结果挂成 context，也要分成两句写：

   ```agentscript
   lessons = Lessons.query({ kind: "how-to" })
   use lessons as "past lessons"
   ```

   这个 "call then use" 写法多写一行，但保住了一个不变量：`use` 始终是 context 声明，不会有副作用；call expression 始终在执行语句里，不会和 context 声明重叠。两类语句一件事，各安其位。

为什么值得：

- **静态可读。** 一次 `generate` 能看到哪些 context source，只取决于源码位置。读者不需要追踪哪些调用产生了哪些 binding 才能知道 prompt 内容。
- **工具杠杆。** agent 的默认 context surface（它的 agent-level `use` 集合）是静态属性。linter、审计工具、文档生成器可以不运行程序就抽取出来。
- **重构安全。** 把 `lessons = Lessons.query(...)` 重构成 helper、加缓存、加条件，都只改 `lessons` 的值流，不动 `use lessons as "past lessons"` 这条声明。Prompt surface 保持视觉稳定。
- **审计清晰。** 每一条 `use` trace 事件对应恰好一条源码声明。"这段文字为什么进了 prompt" 对应一行代码，而不是埋在 call 表达式里。

"call then use" 多一行是这份清晰度的代价。AgentScript 有意承担这个代价。

## 边界模型

AgentScript 定义三类 scope：agent、function、block。它们形成两类边界：**可见边界**（`use` 声明向下传播到子作用域）和**调用边界**（function 或 agent 调用切断 context 传播）。

### Agent boundary

Agent 是 context 的语言单位，同时承担两个角色：

- **Capability boundary**：决定这个 agent 能调用哪些 tool / llm / memory / agent。
- **Context boundary**：agent body 中的 `use` 声明构成该 agent 进入任何 function 时的默认 context。Agent 被调用（`main` 入口或 `import agent` 组合）时，callee 用自己的 agent-level `use`，完全不看 caller 的 context。

```agentscript
import file Playbook from "./playbook.md"
import agent Worker from "./worker.as"

main agent A {
    use Playbook as playbook

    main func(input) {
        return Worker(input)
    }
}
```

`Worker` 内的 `generate` 看不到 `Playbook`，只看到 `Worker` 自己声明的 context。每个 agent 都有独立的 prompt contract。

### Function boundary

Function 是执行单元，不是 context 单元。同一 agent 内不同 function 互相调用时：

- callee 看到它所在 agent 的 agent-level `use`（共享身份的一部分）。
- callee **看不到** caller 的 function-local `use`（执行期选择的 context 不传递）。
- 要让 callee 看到某段 context，caller 必须把数据通过参数传进去，callee 自己再 `use` 一次。

```agentscript
func caller(input) {
    use input.goal as goal
    helper(input)
}

func helper(input) {
    use input.detail as detail
    generate({ input: "Work on detail" }) -> {
        ok: boolean
    }
}
```

`helper` 内的 `generate` 看到的是 `helper` 自己的 `input.detail`（加该 agent 的 agent-level `use`），不是 `caller` 的 `input.goal`。

### Block boundary

`if`、`repeat`、`loop`、`for`、`parallel for` 创建子作用域。block 内声明的 `use` 影响 block 内的 `generate`，block 结束后丢弃，不向外泄漏。block 子作用域不跨越 function 或 agent boundary，所以 block-level `use` 本质上是某条执行路径上 function-level `use` 的局部延展。

## Prompt 层次

一次 `generate` 的 prompt 由四个概念层组成：

1. **Agent identity**：当前 Agent 的 `role`、`description` 和稳定身份。
2. **Selected context**：可见的 `use` 声明，包括已经解析的 `use one of` choice，渲染时带 source、label、value 和 budget 信息。
3. **Instruction**：来自 `generate({ input: ... })` 的本次任务。
4. **Output contract**：可选的 `-> { ... }` contract。

详细构造规则见 [`generate`](./generate.md)。

## 设计检查清单

修改 `use`、scope、context builder、trace 或 LLM provider 行为前，应检查：

- 是否让未 `use` 的数据进入 prompt？
- 是否让 caller context 污染 callee？
- 是否把 tool/model/agent/function binding 当作 prompt data 暴露？
- 是否保留 source、label、budget 和 clipping 信息用于审计？
- 是否保留字符串、list 和 object 已文档化的裁剪顺序？
- 是否把 `use` 退化成快照赋值，而不是延迟 context source？
- 是否仍让 `use one of` 表现为普通 `use` 候选之间的确定性选择，而不是隐藏的 runtime learning state？
- 是否混淆 context budget 和 generation budget？
- 是否混淆 AgentScript context label 和 provider message role？
- agent-level `use` 是否仍保持声明式（不依赖 function-local 状态，不包含 call expression）？
- 是否让 call expression 可以出现在 `use` 里，破坏了 "call then use" 的分离？

AgentScript 的核心价值不是多一种控制流语法，而是让 prompt context 的来源、范围、预算、身份和最终 prompt 形态显式且稳定。
