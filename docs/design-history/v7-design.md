# AgentScript V7 Design

V7 的目标是让 AgentScript 具备**从结构化规格确定性生成 agent 源码**的能力。
具体来说：定义一个 AgentSpec JSON 格式作为 agent 行为设计说明书，实现一套
确定性 compiler 把 AgentSpec 编译成当前合法的 `.as` 源码，并用现有
parser/analyzer 验证生成结果。

V7 不引入新的语言原语。语言核心仍然只有 `use` 和 `generate`。V7 只在
`src/architect/` 下新增一组 TypeScript 模块（schema、validator、compiler），
并把它们包装成一个新的 host tool `host://architect`，让 `.as` 程序能够
validate AgentSpec、compile AgentSpec、analyze 生成源码。

V7 的立场来自已有的语言设计：

```text
Agent context as code.
AgentSpec is the structured blueprint; compiler turns it into auditable code.
```

AgentSpec 不是新语言，不是 YAML config，不是 prompt template。它是一个
JSON 格式的 agent 行为设计说明书，表达：这个 agent 用什么模型、接收什么
输入、调用哪些工具、计算哪些中间值、哪些值进入模型上下文、输出契约是什么。
compiler 把这些声明确定性地 lower 成当前 AgentScript 语法。

## 设计定位

V7 不是通用 code generation，也不试图替代手写 `.as`。它服从 AgentScript 的
核心哲学：

- **显式 capability**：architect tool 通过显式
  `import tool Architect from "host://architect"` 获取。
- **确定性生成**：compiler 是纯函数，不调用 LLM。相同 AgentSpec 输入永远
  产出相同 `.as` 源码。
- **现有工具链验证**：生成的源码必须通过现有 parser + semantic analyzer。
  如果 compiler 产出的代码有语法或语义错误，那是 compiler 的 bug。
- **不发明新语法**：compiler 只生成当前合法的 AgentScript 结构。
- **AgentSpec 是产品 IR**：第一版不另做语言 IR。AgentSpec 承担"比源码更适合
  机器生成和检查"的中间表示角色。

## 目标

V7 Phase 1 支持：

- AgentSpec JSON schema 定义与 TypeScript 类型。
- 两种 agent pattern：
  - `"linear"`：单次 RAG（locals → use → generate）。
  - `"react"`：ReAct 循环（locals → use → loop(reason → act → observe) →
    final generate）。
- AgentSpec validator：schema check、pattern check、type check、tool
  reference check、input/local reference check、model_context reference
  check、ReAct 专项 check（`thought.*` 引用、`stop_when` boolean 字段约束
  等）。
- AgentSpec compiler：AgentSpec → 当前合法 AgentScript source string，按
  `pattern` 分发到 linear 或 react lowering。
- `host://architect` tool，暴露三个方法：
  - `Architect.validateSpec({ spec })` — 校验 AgentSpec，返回诊断列表。
  - `Architect.compileSpec({ spec })` — 确定性编译，返回 `.as` 源码。
  - `Architect.analyzeSource({ source })` — 调用现有 parser/analyzer 检查
    生成源码。
- `agentscript architect` CLI，提供三种入口：
  - `agentscript architect "build a docs assistant..." my_first_agent.as`
    — 用 meta-agent 从自然语言生成 AgentSpec，再编译写出 `.as`。
  - `agentscript architect --spec agent.spec.json my_first_agent.as`
    — 从现有 AgentSpec 编译写出 `.as`。
  - `agentscript architect --check agent.spec.json`
    — 只校验 AgentSpec，不写文件。
- 4 个手写 AgentSpec 样例：
  - linear: `docs-assistant`、`support-agent`、`research-agent`。
  - react: `react-research-agent`（reason → search → observe 循环）。
- 端到端集成测试：spec → compile → parse → analyze → 全绿。
- 一个示例 meta-agent `examples/meta/architect.as`，展示用 `.as` 调用
  `host://architect` 工具完成 NL → AgentSpec → validate → compile → analyze
  的完整流程。

V7 Phase 1 不支持：

- scenario/test 生成（留给 Phase 2）。
- behavior package 写入（第一版只返回 source string，不写文件）。
- policy coverage check（需要更多实际案例验证 policy 枚举设计）。
- 自然语言 → AgentSpec 的 prompt engineering（meta-agent 示例会做，但不是
  toolchain 的职责）。
- AgentSpec 的 GUI editor 或 Studio。
- 新的 AgentScript 语法。

## AgentSpec 格式

AgentSpec 的字段、类型系统、引用解析、lowering 规则、validator 检查项都
定义在独立的语言规范文档中：

- 中文：[`docs/cn/agent-spec.md`](../cn/agent-spec.md)
- English：[`docs/en/agent-spec.md`](../en/agent-spec.md)

V7 设计层面只关注三点契约：

1. **AgentSpec 是 JSON**，每个字段都能确定性 lower 到当前 AgentScript 语法；
   无法表达的概念不进 AgentSpec。
2. **Validator-Compiler 契约**：任何通过 validator 的 AgentSpec，compiler
   都必须生成通过当前 parser + semantic analyzer 的 `.as` 源码。
3. **Pattern 是开放扩展点**：`pattern: "linear" | "react"` 是 Phase 1 的
   两种 agent 控制流形态。未来添加 `"plan_execute"`、`"reflection"` 或
   通用 `"stages"` 都是 additive 改动，不破坏既有 spec 的语义。validator
   遇到未知 pattern 必须返回 `UNSUPPORTED_PATTERN` 诊断，不静默放过。

实现层需要区分两个 TypeScript 类型：

```typescript
type AgentSpecDraft = Record<string, unknown>;
```

`AgentSpecDraft` 表示来自 LLM、JSON 文件或 tool 入参的未验证对象。validator
接收 draft，返回诊断；只有 `validateSpec(draft).ok === true` 后，compiler
才把它视为 `AgentSpec`。这样缺字段、字段类型错误都能由 validator 报告精确
路径，而不是在 tool 入参解析阶段被整体拒绝。

`invalid_input` soft error 只用于非 object、数组、null 等根本不是 AgentSpec
draft 的输入。

## host://architect Tool

### 注册方式

与 `host://optimizer` 相同的 host tool 模式。通过
`import tool Architect from "host://architect"` 获取。

默认 `HostToolProvider` 注册此 tool，与 `host://optimizer` 并列。如果
嵌入式调用传入自定义 `toolProvider`，宿主需要自行决定是否暴露
`host://architect`。

### 方法

#### `Architect.validateSpec`

入参：

```json
{
  "spec": { ... }
}
```

返回：

```json
{
  "ok": true,
  "diagnostics": []
}
```

或：

```json
{
  "ok": false,
  "diagnostics": [
    {
      "severity": "error",
      "code": "UNKNOWN_TOOL_METHOD",
      "path": "/locals/0/source",
      "message": "Docs.search is used but Docs has no method 'search' declared.",
      "suggested_fix": "Add { name: 'search', purpose: '...' } to tools[0].methods."
    }
  ]
}
```

规则：
- `ok` 为 `true` 当且仅当没有 severity == "error" 的诊断。
- warning 不影响 `ok` 状态。Phase 1 可以先不产生 warning。
- `spec` 不是非数组 JSON object 时返回 `{ ok: false, code: "invalid_input" }`。
- `spec` 是 object 但缺字段或字段类型错误时，返回 `{ ok: false, diagnostics }`。

诊断条目的字段语义见 `docs/cn/agent-spec.md` 的 "验证规则" 一节。

#### `Architect.compileSpec`

入参：

```json
{
  "spec": { ... }
}
```

返回：

```json
{
  "ok": true,
  "source": "import llm Qwen from ...\n..."
}
```

规则：
- 只接受通过 validateSpec 无 error 的 spec。如果 spec 有 validation error，
  返回 `{ ok: false, code: "validation_required" }`。
- compiler 内部先调用 validator；如果有 error 直接拒绝。
- `source` 是完整的 `.as` 源码字符串，必须通过当前 parser + semantic
  analyzer。

#### `Architect.analyzeSource`

入参：

```json
{
  "source": "import llm Qwen from ..."
}
```

返回：

```json
{
  "ok": true,
  "diagnostics": []
}
```

规则：
- 调用现有 `parse()` + `analyze()` 对 source string 做完整检查。
- 返回所有 severity == "error" 的语义诊断。
- 如果 parse 失败，返回 parse error。
- 这是对 compiler 输出的二次验证。正常情况下 compiler 产出的代码不应有
  分析错误；如果有，说明 compiler 有 bug。

### 错误模型

与 V6 一致：

- **soft error**：`{ ok: false, code, message, ... }`，可被调用方处理。
- **hard error**：`RuntimeError`，仅限于入参类型错误等编程错误。

## Architect CLI

`agentscript architect` 是 V7 的用户入口。它复用 `host://architect` 的
validator/compiler/analyzer，但承担文件读写、自然语言入口和进程退出码。

### 命令形态

```bash
agentscript architect "build a docs assistant..." my_first_agent.as
agentscript architect "build a docs assistant..." my_first_agent.as --model ollama://localhost:11434/qwen3.6
agentscript architect --spec agent.spec.json my_first_agent.as
agentscript architect --check agent.spec.json
```

语义：

- `agentscript architect "<request>" <output.as>`：
  - 运行内置 meta-agent 或等价流程，将自然语言 request 转成 AgentSpec draft。
  - validate → repair（可选）→ compile → analyze。
  - analyze 成功后写出 `<output.as>`。
  - 可用 `--model <uri>` 指定传给 meta-agent 的 preferred model URI；默认
    `ollama://localhost:11434/qwen3.6`。
- `agentscript architect --spec <spec.json> <output.as>`：
  - 读取 JSON AgentSpec。
  - validate → compile → analyze。
  - analyze 成功后写出 `<output.as>`。
- `agentscript architect --check <spec.json>`：
  - 只运行 validator。
  - 有 error 时退出非零，不写文件。

约束：

- CLI 不引入新语言语法。
- CLI 写文件前必须完成 `validateSpec`、`compileSpec`、`analyzeSource` 三步。
- 第一版只写单个 `.as` 文件；behavior package 留给 Phase 2。
- 自然语言模式需要可用 LLM；`--mock` 只验证流程结构，不保证生成有用 spec。

## 实现模块

```text
src/architect/
  spec/
    types.ts          — AgentSpec TypeScript 类型定义（含 pattern discriminated union）
    schema.ts         — AgentSpec draft 解析与守卫

  validator/
    index.ts          — validator 入口，聚合所有 check
    schema-check.ts   — 必填字段、标识符格式
    pattern-check.ts  — pattern 字段值与 pattern 块的存在性
    type-check.ts     — 类型枚举验证
    reference-check.ts — tool / input / local 引用验证
    context-check.ts  — model_context 引用和格式验证
    react-check.ts    — ReAct 专项检查（thought.* / stop_when / 保留名）

  compiler/
    index.ts          — compiler 入口，按 pattern 分发
    emit.ts           — 共用子 emitter（imports / agent / contract / use / final generate）
    emit-linear.ts    — linear pattern 主体
    emit-react.ts     — react pattern 主体（loop / scratch / done 收尾）

  tool/
    provider.ts       — ArchitectToolProvider（host://architect）

tests/architect/
  validator.test.ts
  compiler.test.ts
  integration.test.ts — spec → compile → parse → analyze 端到端

fixtures/architect/
  docs-assistant.spec.json
  support-agent.spec.json
  research-agent.spec.json
  react-research-agent.spec.json

examples/meta/
  architect.as        — meta-agent 示例
```

## 与现有代码的关系

### 复用

- `src/parser/parser.ts` — analyzeSource 直接调用。
- `src/semantic/analyzer.ts` — analyzeSource 直接调用。
- `src/providers/tools/shared.ts` — tool provider 的参数解析工具。
- `src/runtime/types.ts` — ToolProvider 接口、RuntimeValue 类型。

### 不修改

- parser、semantic analyzer、runtime、现有 tool providers 不做任何修改。
- AST 类型不变。
- 现有测试不受影响。

### 新增注册

- `HostToolProvider` 的 host namespace map 中注册 `host://architect`（与
  `host://optimizer` 并列）。
- `package.json` 暴露 `@rong/agentscript/architect/spec/types`，供 TypeScript
  embedders 构造 AgentSpec。

## Meta-agent 示例

`examples/meta/architect.as` 展示完整流程：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Architect from "host://architect"

main agent AgentScriptArchitect {
    model Qwen
    role "AgentScript meta-agent architect"
    description "Generate AgentScript agents from natural-language requirements."

    main func(input {
        request: string
        target_name: string
        model_uri: string
    }) {
        use input.request as "user agent requirement"
        use input.target_name as "target agent name"
        use input.model_uri as "preferred model uri"

        draft = generate({
            input: "Convert the user requirement into an AgentSpec JSON object. Follow the AgentSpec schema exactly. Return the spec, assumptions, and any missing requirements.",
            max_output: 6000
        }) -> {
            spec: json
            assumptions: list[string]
            missing_requirements: list[string]
        }

        validation = Architect.validateSpec({
            spec: draft.spec
        })

        repaired = draft.spec
        repair_summary = "no repair needed"

        if not validation.ok {
            use draft.spec as "draft AgentSpec"
            use validation as "validation diagnostics"

            repair = generate({
                input: "Repair the AgentSpec based on the validation diagnostics. Preserve the user's intent. Return the corrected spec and a brief summary of changes.",
                max_output: 6000
            }) -> {
                spec: json
                repair_summary: string
            }

            repaired = repair.spec
            repair_summary = repair.repair_summary
        }

        compiled = Architect.compileSpec({
            spec: repaired
        })

        source = ""
        analysis = {
            ok: false,
            diagnostics: []
        }

        if compiled.ok {
            source = compiled.source
            analysis = Architect.analyzeSource({
                source: source
            })
        }

        use source max 4k as "generated AgentScript source"
        use compiled as "compile result"
        use analysis as "source analysis result"

        review = generate({
            input: "Summarize the generated agent. Explain what it does, what enters model context, the output contract, and any assumptions.",
            max_output: 1200
        }) -> {
            summary: string
            model_context_summary: list[string]
            output_fields: list[string]
        }

        return {
            summary: review.summary,
            source: source,
            validation_ok: validation.ok,
            compile_ok: compiled.ok,
            analysis_ok: analysis.ok,
            assumptions: draft.assumptions,
            model_context_summary: review.model_context_summary,
            output_fields: review.output_fields,
            repair_summary: repair_summary
        }
    }
}
```

这个示例可以用 `--mock` 跑通结构，用真实 LLM 跑端到端。

## 与 V6 的关系

V6 是"用 AgentScript 优化 AgentScript"（source → source 变换）。
V7 是"用 AgentScript 生成 AgentScript"（spec → source 生成）。

两者共享同一个设计哲学：

- 操作 `.as` 源码的能力通过 host tool 暴露。
- 策略/生成逻辑写在 `.as` 里，toolchain 只提供确定性原语。
- 不引入新语言语法。

V7 的 `host://architect` 和 V6 的 `host://optimizer` 是并列的 host tool，
互不依赖。未来可以组合使用：先用 architect 生成 agent，再用 optimizer
优化其 `use one of` 选择。

## 实施顺序

### Step 1：AgentSpec 类型与 schema（含 pattern dispatch）

定义 TypeScript 类型、运行时类型守卫、JSON schema 验证函数。类型层用
discriminated union 表达 `pattern: "linear" | "react"`。

交付物：`src/architect/spec/types.ts`、`src/architect/spec/schema.ts`

验收：类型定义通过 typecheck；schema 函数能正确区分合法/非法 spec。

### Step 2：手写 linear fixture 样例

`fixtures/architect/docs-assistant.spec.json` 和
`fixtures/architect/support-agent.spec.json`。

用样例反推 schema 是否够用。如果发现表达力不足，回到 Step 1 调整。

### Step 3：Validator（含 pattern check 与 ReAct check）

实现 schema-check、pattern-check、type-check、reference-check、
context-check、react-check。

交付物：`src/architect/validator/` 全部文件 + 单元测试。

验收：对样例 spec 返回 `ok: true`；对故意破坏的 spec 返回正确诊断。

### Step 4：Compiler（含 pattern dispatch）

实现 AgentSpec → AgentScript source string 的确定性生成。compiler 入口
按 `pattern` 分发到 `emitLinear` 或 `emitReact`。共享 imports / agent /
input contract / locals / model_context / final generate 的子 emitter。

交付物：`src/architect/compiler/` 全部文件 + 单元测试。

验收：对样例 spec 生成的源码能通过 `parse()` + `analyze()` 无 error。

### Step 5：ReAct fixture 与端到端测试

补充 `fixtures/architect/react-research-agent.spec.json`，验证 ReAct
lowering 端到端通过。

交付物：`tests/architect/integration.test.ts` 覆盖所有 fixture（linear +
react）。

### Step 6：host://architect tool provider

包装 validator + compiler + analyzer 为 ToolProvider，并挂到默认
`HostToolProvider` 的 host namespace map。

交付物：`src/architect/tool/provider.ts`、`src/providers/tools/host.ts` 注册代码。

验收：`agentscript examples/meta/architect.as --mock` 能跑通。

### Step 7：Architect CLI

实现 `agentscript architect` 子命令，支持自然语言、`--spec` 和 `--check`
三种入口。

交付物：CLI 参数解析与 runner；必要时新增 `src/bin/architect.ts`。

验收：

```bash
agentscript architect --check fixtures/architect/docs-assistant.spec.json
agentscript architect --spec fixtures/architect/docs-assistant.spec.json /tmp/docs-assistant.as
agentscript architect "build a docs assistant..." /tmp/my_first_agent.as --mock
```

三条命令都能按预期完成或给出结构化错误。

### Step 8：Meta-agent 示例

写 `examples/meta/architect.as`，配合 README 说明。meta-agent 的 prompt
要让 LLM 显式选择 `pattern`（linear vs react）。

交付物：示例文件 + `examples/meta/README.md`

### Step 9：补充第 4 个样例 + research_agent

补充 `fixtures/architect/research-agent.spec.json`（linear），验证 schema
对不同 agent kind 的覆盖度。最终 4 个 fixture：3 个 linear + 1 个 react。

## 成功标准

V7 Phase 1 完成后必须满足：

1. 任何通过 validator 的 AgentSpec，compiler 都能生成通过 parser/analyzer
   的 `.as` 源码。
2. 生成的源码风格一致、可读、可 diff。
3. `host://architect` 三个方法的入参/返参 schema 稳定。
4. `agentscript architect --spec` 和 `agentscript architect --check` 可用；
   自然语言入口在 `--mock` 下能跑通流程结构。
5. meta-agent 示例能用 `--mock` 跑通完整流程，包括 validate/compile/analyze
   失败时的结构化返回路径。
6. 零运行时依赖不变。
7. 现有测试全部通过，无回归。

## 非目标

V7 Phase 1 明确不做：

- Policy coverage check（需要更多实际案例验证 policy 枚举）。
- Scenario/test 生成（留给 Phase 2）。
- Behavior package 文件写入（第一版只返回 source string）。
- AgentSpec 的 GUI/Studio。
- 自然语言 → AgentSpec 的 prompt 优化（meta-agent 示例会做基础版，但不是
  toolchain 职责）。
- 多 agent 文件生成（第一版只生成单文件单 agent）。
- `linear` / `react` 之外的 pattern。`plan_execute` / `reflection` /
  通用 `stages`（带表达式语言）留给 Phase 2 作为新 pattern 加入；
  `pattern` 字段已经为这些扩展预留位置。
- `if` / `else` 等条件分支的 lowering（不在任何 Phase 1 pattern 范围内）。
- `parallel for` 的 lowering。
- ReAct 内多步 act 或基于 list 的工具选择。
- `use one of` 的生成（留给 Phase 2，与 V6 optimizer 联动）。
- 新的 AgentScript 语法。

## 设计不变式

V7 Phase 1 完成后仍必须成立：

- 语言核心只有 `use` / `generate`；无 `spec` / `compile` 关键字。
- AgentSpec 是 JSON，不是新语言。
- compiler 是纯函数，不调用 LLM。
- 生成的 `.as` 源码必须通过现有 parser + semantic analyzer。
- `host://architect` 是显式 capability。默认 `HostToolProvider` 会注册它；
  自定义嵌入式 `toolProvider` 不会自动获得它。
- 零运行时依赖。

## Phase 2 展望（不阻塞 Phase 1）

Phase 1 稳定后可以考虑：

- **Policy coverage check**：定义 policy 枚举，每个 policy 有结构化检查规则。
- **Scenario 生成**：从 AgentSpec 自动生成 `scenarios.json`。
- **Behavior package**：`Architect.writePackage` 写出完整目录。
- **Repair loop 优化**：让 meta-agent 用 `loop until` 做多轮 validate-repair。
- **与 V6 联动**：生成的 agent 包含 `use one of`，可以被 optimizer 优化。
- **AgentSpec 扩展**：支持条件 locals、多函数 agent、agent 间调用。
