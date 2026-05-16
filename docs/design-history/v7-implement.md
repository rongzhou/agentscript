# AgentScript V7 实施计划

本文档描述 V7 Phase 1 的实施方案。V7 设计见 `v7-design.md`。AgentSpec 的
字段、引用规则、lowering 规则、validator 检查项定义在
`docs/cn/agent-spec.md` / `docs/en/agent-spec.md`。本实施计划聚焦代码层面
的接口、模块划分、测试策略和实施顺序。

V7 Phase 1 的实现目标：AgentSpec 类型定义与 draft 解析、AgentSpec
validator（schema/pattern/type/reference/context/react check）、AgentSpec
compiler（spec → source string，按 pattern 分发到 linear 或 react
lowering）、`host://architect` tool provider（validateSpec / compileSpec /
analyzeSource）、`agentscript architect` CLI、4 个 fixture spec 样例
（3 个 linear + 1 个 react）、端到端集成测试、一个 meta-agent 示例。

V7 Phase 1 不改变语言语法，不引入新的语言关键字，不引入 runtime
dependency。所有工作集中在：

- `src/architect/` 下新增 spec/validator/compiler/tool 四个子模块，其中
  `compiler/analyze.ts` 封装生成源码的 parser + semantic analyzer 检查；
- `src/host-tools.ts` 将 `host://architect` 与 `host://optimizer` 注入默认
  AgentScript host namespace；
- `src/language/schemes.ts` 新增 `ARCHITECT_SCHEME` 常量；
- `src/bin/` 增加 architect CLI runner；
- fixture spec JSON 文件；
- 测试与示例。

## 原则

- AgentSpec 是 JSON，不是新语言。compiler 是纯函数，不调用 LLM。
- `host://architect` 是内置 host tool scheme，与 `host://optimizer` 并列。
- validator 和 compiler 的逻辑完全独立于 runtime；它们不 import runtime
  模块（除了 types）。analyzeSource 复用现有 parser + semantic analyzer。
- soft error 走 `{ ok: false, code, ... }`；hard error（入参 schema 违反）
  才抛 `RuntimeError`。
- 不新增 npm dependency。零运行时依赖不变。
- 现有测试不受影响，不修改现有模块的公共 API。

## 前置依赖

V7 依赖已有能力：

- `parse(source)` 函数（`src/parser/parser.ts`）。
- `analyze(program)` 函数（`src/semantic/analyzer.ts`）。
- `ToolProvider` 接口与 `ToolCallRequest` 类型（`src/runtime/types.ts`）。
- `HostToolProvider` / `HostNamespaceProvider` 注册模式
  （`src/providers/tools/host.ts`）。
- `OPTIMIZER_SCHEME` 常量模式（`src/language/schemes.ts`）。
- `expectObject` / `readRequiredString` 等参数解析工具
  （`src/providers/tools/shared.ts`）。

V7 不依赖 V6 的任何模块。两者完全独立。

## 阶段 0：AgentSpec 类型定义

状态：计划中。

目标：把 `agent-spec.md` 里的字段定义反映成 TypeScript 类型，并提供 draft
解析工具。

新增模块：

```text
src/architect/spec/types.ts
```

### types.ts

按 `agent-spec.md` 中的"顶层结构"和各字段定义，导出对应的 TypeScript
interface。`AgentSpec` 用 discriminated union 表达 pattern：

```ts
export interface AgentSpecBase {
  version: "0.1";
  agent: AgentSpecAgent;
  model: AgentSpecModel;
  inputs: Record<string, AgentSpecInput>;
  tools: AgentSpecTool[];
  locals: AgentSpecLocal[];
  model_context: AgentSpecContext[];
  generation: AgentSpecGeneration;
  output: AgentSpecOutput;
  assumptions?: string[];
}

export interface LinearAgentSpec extends AgentSpecBase {
  pattern?: "linear";          // 省略等价于 "linear"
}

export interface ReactAgentSpec extends AgentSpecBase {
  pattern: "react";
  react: AgentSpecReact;
}

export type AgentSpec = LinearAgentSpec | ReactAgentSpec;

export interface AgentSpecReact {
  max_iterations: number;
  scratch: { label: string; max: string };
  reason: {
    input: string;
    max_output?: number;
    output: AgentSpecOutput;     // 复用顶层 output 类型（fields: Record<...>）
  };
  act: {
    tool: string;
    method: string;
    args: Record<string, string>;
  };
  stop_when: string;           // "thought.<field>"
}

export type AgentSpecType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "list[string]"
  | "list[number]"
  | "list[boolean]"
  | "list[json]";

export const AGENT_SPEC_TYPES: ReadonlySet<AgentSpecType> = new Set([
  "string", "number", "boolean", "json",
  "list[string]", "list[number]", "list[boolean]", "list[json]",
]);

export const SUPPORTED_PATTERNS: ReadonlySet<string> = new Set([
  "linear",
  "react",
]);
```

子接口（`AgentSpecAgent` / `AgentSpecModel` / `AgentSpecInput` /
`AgentSpecTool` / `AgentSpecMethod` / `AgentSpecLocal` /
`AgentSpecLocalSource` / `AgentSpecContext` / `AgentSpecGeneration` /
`AgentSpecOutput` / `AgentSpecOutputField`）一一对应 `agent-spec.md` 的
字段定义，字段名与 JSON key 完全一致。`AgentSpecLocalSource.kind` 类型为
字面量 `"tool_call"`。

`SUPPORTED_PATTERNS` 是 validator 与 compiler 共享的 pattern 注册表。
将来增加 `"plan_execute"` 等 pattern 时只需扩展这个集合并加上对应的
type union 分支。

`types.ts` 同时导出 draft object 的轻量守卫：

```ts
export type AgentSpecDraft = Record<string, unknown>;

export function asAgentSpecDraft(value: unknown): AgentSpecDraft | null;
```

`asAgentSpecDraft` 只判断输入是不是非数组、非 null 的 object。字段
存在性、字段类型、标识符格式、引用关系全部交给 validator。这样缺字段、
字段类型错误等问题都能由 validator 给出精确诊断路径，而不是在 tool
入参解析阶段被整体拒绝。

返回 `null` 表示连 draft object 都不是，tool provider 应返回
`{ ok: false, code: "invalid_input" }`。

验收：

- `npm run typecheck` 通过。
- `asAgentSpecDraft` 对合法 spec 返回 draft object。
- `asAgentSpecDraft` 对缺少 `version` 的 object 仍返回 draft object
  （validator 会报 `MISSING_FIELD`）。
- `asAgentSpecDraft` 对 `null`、`[]`、`"string"` 等返回 `null`。

## 阶段 1：Fixture spec 样例

状态：计划中。

目标：手写 AgentSpec JSON 样例，作为后续 validator 和 compiler 的测试
fixture，并反推 schema 是否够用。Phase 1 共 4 个 fixture：3 个 linear +
1 个 react。

阶段 1 先写 2 个 linear fixture（docs-assistant、support-agent）跑通
linear lowering；ReAct fixture 在阶段 5 补齐；research-agent linear
fixture 在阶段 8 补齐。

新增文件（本阶段）：

```text
fixtures/architect/docs-assistant.spec.json
fixtures/architect/support-agent.spec.json
```

### docs-assistant

最简单的单工具 agent，用于 happy path：

- `pattern` 省略（等价于 `"linear"`），同时验证 default pattern 行为。
- 一个 `Docs` tool，一个 `search` 方法。
- 一个 local（`relevant_docs`）。
- 两条 model_context（`input.question` 和 `local.relevant_docs`）。
- 四个输出字段（`answer` / `citations` / `confidence` /
  `missing_information`）。

完整 JSON 内容由 `agent-spec.md` 中的"顶层结构"示例 + 上述形状决定。

### support-agent

多工具、多 local、local 间依赖、部分 local 不进入 model_context 的典型
场景：

- 显式声明 `pattern: "linear"`，验证显式 linear 与 default linear 行为
  一致。
- 三个 tool：`Docs`、`Orders`、`CRM`。
- 四个 local：`refund_docs`、`order_summary`、`internal_notes`、
  `escalation_signal`。其中 `escalation_signal` 引用
  `local.internal_notes`（验证 local 间依赖）。
- model_context 包含 `escalation_signal` 但不包含 `internal_notes`
  （验证"计算但不展示给模型"的设计意图）。

具体字段填写参考 `agent-spec.md` 中各字段的约束。

验收：

- 两个 JSON 文件 `JSON.parse` 无错。
- 手动审查每个 spec 的 locals 引用链、model_context 引用、tool 引用都
  自洽。
- 跑阶段 2 的 validator 后两个 fixture 都返回 `{ ok: true,
  diagnostics: [] }`。

## 阶段 2：Validator 实现

状态：计划中。

目标：实现 AgentSpec validator，对任意 JSON 输入产出精确的诊断列表。

新增模块：

```text
src/architect/validator/index.ts
src/architect/validator/schema-check.ts
src/architect/validator/pattern-check.ts
src/architect/validator/type-check.ts
src/architect/validator/reference-check.ts
src/architect/validator/context-check.ts
src/architect/validator/react-check.ts
tests/architect/validator.test.ts
```

### 公共类型与入口

```ts
// src/architect/validator/index.ts
export interface SpecDiagnostic {
  severity: "error" | "warning";
  code: string;
  path: string;            // JSON pointer：/agent/name、/locals/0/source/tool
  message: string;
  suggested_fix?: string;
}

export interface ValidateResult {
  ok: boolean;
  diagnostics: SpecDiagnostic[];
}

export function validateSpec(spec: AgentSpecDraft): ValidateResult;
```

`validateSpec` 聚合所有 check 的诊断，`ok` 为 `true` 当且仅当无 error 级
诊断。compiler 在 validation 通过后将 draft 收窄为 typed `AgentSpec`。

诊断不短路：不同 check 之间互相独立，出现一个 schema 错误不应阻止后续
check 报告其它问题。但一个 spec 的 pattern 若是未知值
（`UNSUPPORTED_PATTERN`），后续 react-check 会跳过（无从知道是不是该跑），
其它 check（schema/type/reference/context）继续跑。

### 检查项映射

`agent-spec.md` 的"验证规则"列出全部规则，validator 按以下文件分组实现：

| 模块 | 覆盖 `agent-spec.md` 中的规则 | 错误码 |
|------|--------------------------------|--------|
| schema-check.ts | "Schema check" 全部条目 | `MISSING_FIELD`、`INVALID_VERSION`、`INVALID_IDENTIFIER`、`EMPTY_VALUE`、`INVALID_TYPE`、`INVALID_VALUE`、`UNSUPPORTED_KIND`、`INVALID_SHAPE` |
| pattern-check.ts | "Pattern check" | `UNSUPPORTED_PATTERN`、`MISSING_PATTERN_BLOCK`、`UNEXPECTED_PATTERN_BLOCK` |
| type-check.ts | "Type check" | `UNSUPPORTED_TYPE` |
| binding-check.ts | "Binding uniqueness check" | `DUPLICATE_BINDING` |
| reference-check.ts | "Tool reference check" + "Reference check" | `UNKNOWN_TOOL`、`UNKNOWN_TOOL_METHOD`、`UNKNOWN_INPUT_REF`、`UNKNOWN_LOCAL_REF`、`FORWARD_LOCAL_REF` |
| context-check.ts | "Model context check" | `EMPTY_MODEL_CONTEXT`、`INVALID_CONTEXT_SOURCE`、`INVALID_BUDGET_FORMAT` |
| react-check.ts | "React 专项检查" | `UNKNOWN_THOUGHT_REF`、`INVALID_STOP_WHEN`、`STOP_WHEN_NOT_BOOLEAN`、`RESERVED_IDENTIFIER`、`INVALID_BUDGET_FORMAT`、`UNSUPPORTED_TYPE`、`UNKNOWN_TOOL`、`UNKNOWN_TOOL_METHOD`、`UNKNOWN_INPUT_REF`、`UNKNOWN_LOCAL_REF` |

实现要点：

- 标识符正则统一在一个常量文件里：agent name `/^[A-Z][A-Za-z0-9_]*$/`，
  其它标识符 `/^[A-Za-z_][A-Za-z0-9_]*$/`。具体规则见 `agent-spec.md`。
- `INVALID_VERSION` 只在 `version` 字段类型正确但值不是 `"0.1"` 时报告；
  `version` 缺失时报 `MISSING_FIELD`。
- `pattern-check` 先于 `react-check`：必须先确定 pattern 是 `"react"`，
  才会跑 react-check。pattern 缺省时按 `"linear"` 处理；显式 `"linear"`
  与省略 `pattern` 的 spec 行为一致。
- `react-check` 在 schema check 通过基础上做：复用 reference check 的
  helper 验证 `react.act.tool/method/args` 中的 `input.*` 与 `local.*`
  引用；新增 `thought.<field>` 解析仅在 `react.act.args` 内允许，且必须
  匹配 `react.reason.output.fields` 中声明的字段名。
- `react.stop_when` 解析为字面量 `"thought.<field>"`，validator 解析后
  检查 `<field>` 是 `react.reason.output.fields` 中声明的 boolean。
  非此格式报 `INVALID_STOP_WHEN`；字段不存在报 `UNKNOWN_THOUGHT_REF`；
  字段存在但类型非 boolean 报 `STOP_WHEN_NOT_BOOLEAN`。
- 引用 check 必须在 schema check 之后——schema check 保证了字段存在和形状，
  reference check 才能放心地按下标遍历 `tools` / `locals` 数组。validator
  入口先跑 schema check，发现 error 后仍继续跑后续 check（让用户一次拿到
  尽可能多的诊断），但后续 check 在遇到字段缺失/类型错误时应安全跳过该
  条目而不抛错。
- `path` 全部使用 JSON pointer 风格，便于工具或 LLM 直接定位。

### 测试覆盖

`tests/architect/validator.test.ts` 至少覆盖：

- 两个 fixture spec 通过 validate 返回 `ok: true`。
- 每种错误码至少一个 case：
  - `MISSING_FIELD`：删除 `agent.name`。
  - `INVALID_VERSION`：`version = "0.2"`。
  - `INVALID_IDENTIFIER`：`agent.name = "lowercase"`。
  - `EMPTY_VALUE`：`agent.role = ""`。
  - `UNSUPPORTED_PATTERN`：`pattern = "loop"`。
  - `MISSING_PATTERN_BLOCK`：`pattern = "react"` 但缺 `react` 块。
  - `UNEXPECTED_PATTERN_BLOCK`：`pattern = "linear"` 但出现 `react` 块。
  - `UNSUPPORTED_TYPE`：`inputs.x.type = "object"`。
  - `UNKNOWN_TOOL`：`locals[0].source.tool = "NonExistent"`。
  - `UNKNOWN_TOOL_METHOD`：`locals[0].source.method = "nonExistent"`。
  - `UNKNOWN_INPUT_REF`：arg 引用 `"input.nonexistent"`。
  - `UNKNOWN_LOCAL_REF`：arg 引用 `"local.nonexistent"`。
  - `FORWARD_LOCAL_REF`：local B 引用 local A，但 B 在 A 之前。
  - `INVALID_CONTEXT_SOURCE`：`model_context[0].source = "unknown.ref"`。
  - `EMPTY_MODEL_CONTEXT`：`model_context = []`。
  - `INVALID_BUDGET_FORMAT`：`max = "abc"`。
  - `UNKNOWN_THOUGHT_REF`：`react.act.args` 引用 `"thought.notdeclared"`。
  - `INVALID_STOP_WHEN`：`stop_when = "thought.done == true"`（不是字面量
    `"thought.<field>"` 形式）。
  - `STOP_WHEN_NOT_BOOLEAN`：`stop_when = "thought.focus"`，但 `focus`
    类型是 `string`。
  - `RESERVED_IDENTIFIER`：在 ReAct spec 中把 `inputs.thought` 或
    `locals[*].name = "scratch"` 等保留名作为标识符使用。
  - `RESERVED_IDENTIFIER`：`output.fields.thought` 或
    `react.reason.output.fields.scratch` 这类 contract field 使用 ReAct 保留名
    （`done` 除外）。
- 多个错误同时存在时，diagnostics 包含所有错误（不短路）。
- draft 结构层面错误（缺顶层字段、字段类型错）不会让后续 check 抛 runtime
  exception，仍能聚合诊断返回。

验收：

- `npm run typecheck` 通过。
- validator 单元测试全绿。
- 两个 fixture spec validate 返回 `{ ok: true, diagnostics: [] }`。

## 阶段 3：Compiler 实现

状态：计划中。

目标：实现 AgentSpec → AgentScript source string 的确定性编译器，按
`pattern` 分发到对应 lowering。

新增模块：

```text
src/architect/compiler/index.ts
src/architect/compiler/emit.ts          — 共用子 emitter（imports/agent/contract/use 等）
src/architect/compiler/emit-linear.ts   — linear pattern 主体
src/architect/compiler/emit-react.ts    — react pattern 主体
tests/architect/compiler.test.ts
```

### 入口

```ts
// src/architect/compiler/index.ts
import { validateTypedSpec } from "../validator/index.js";
import { emitLinear } from "./emit-linear.js";
import { emitReact } from "./emit-react.js";
import type { AgentSpecDraft } from "../spec/types.js";
import type { SpecDiagnostic } from "../validator/index.js";

export type CompileResult =
  | { ok: true; source: string }
  | { ok: false; code: "validation_required"; diagnostics: SpecDiagnostic[] };

export function compileSpec(spec: AgentSpecDraft): CompileResult;
```

`compileSpec` 内部先调用 `validateTypedSpec`；如果有 error 级诊断，返回
`{ ok: false, code: "validation_required", diagnostics }`。否则使用 validator
返回的 typed `AgentSpec`，再按 `pattern` 分发：

```ts
const typed = validation.spec;
const pattern = typed.pattern ?? "linear";
const source = pattern === "react" ? emitReact(typed) : emitLinear(typed);
```

### 共用 emit 模块

`emit.ts` 提供共享的子 emitter：

```ts
export function emitImports(spec: AgentSpec): string;
export function emitAgentHeader(spec: AgentSpec): string;     // main agent + model/role/description
export function emitInputContract(inputs: ...): string;
export function emitLocals(locals: ...): string;              // 缩进感知
export function emitModelContext(ctx: ...): string;
export function emitFinalGenerate(spec: AgentSpec): string;   // 最后那个 return generate
export function resolveArgExpr(value: string): string;        // input./local. 解析（不含 thought.）
```

`emitContractFields`、`emitGenerateOptions`、`resolveContextSource` 等仅在
`emit.ts` 内部使用的 helper 保持 module-private，避免扩大 compiler 的公开
内部接口。

`emit-linear.ts` 与 `emit-react.ts` 调用这些 helper 拼接最终源码，差别仅
在 main func body 中间段。

### emit.ts 与 emit-react.ts 的差异

linear 主体：

```text
locals
(空行)
model_context use 语句
(空行)
return generate(...) -> { ... }
```

react 主体：

```text
locals
(空行)
model_context use 语句
(空行)
scratch = []
use scratch.summary max <max> as <label>
done = false

loop until done max <N> {
    thought = generate({...}) -> { reason.output.fields }

    obs = <act.tool>.<act.method>({ args lowered with input./local./thought. })
    scratch.add(obs)
    done = thought.<stop_when 字段>
}

return generate({...}) -> { output.fields }
```

`emit-react.ts` 多出一个解析器：

```ts
function resolveActArgExpr(value: string): string;
// "input.xxx"   → "input.xxx"
// "local.xxx"   → "xxx"
// "thought.xxx" → "thought.xxx"
// 其它          → JSON.stringify(value)
```

`stop_when` 解析为 `thought.<field>` 中的 `<field>`，直接拼成 `done =
thought.<field>`。validator 已保证类型为 boolean。

### 格式约束（共用）

- **缩进**：4 空格。
- **字符串字面量**：使用 `JSON.stringify(value)` 等价逻辑。lower 到 `.as`
  源码的所有字符串字段（`agent.role`、`agent.description`、`model.uri`、
  `tools[*].uri`、`generation.input`、`react.reason.input`、
  `model_context[*].label`、`react.scratch.label`、args 字面量）都要走
  `JSON.stringify`，不允许手工拼引号。这是 compiler 正确性的核心保证之一。
- **空行**：imports 之后一个空行；agent 声明内 config 与 func 之间一个
  空行；func body 内 locals 块、use 块、loop 块、final generate 块之间
  各一个空行。相邻 local 赋值之间一个空行；相邻 `use` 之间不加空行。
  ReAct 中 reason generate 与 act tool call 之间不加空行（它们是同一
  逻辑步的两半）。
- **尾换行**：源码末尾一个 `\n`。

类型映射直接输出（`AgentSpecType` 字符串值与 AgentScript contract type
形状一致），无需转换。

`max_output` 未指定时，emit 在 `generate` options 里**省略**该字段——不要
输出 `max_output: undefined` 或 `max_output: 0`。reason 与 final
generate 都遵循此规则。

### 测试

`tests/architect/compiler.test.ts` 至少覆盖：

- 对 docs-assistant、support-agent、react-research-agent fixture 编译，
  输出与预期 snapshot 字符串完全匹配（推荐 `toMatchInlineSnapshot` 便于
  review）。
- validation error 时返回 `{ ok: false, code: "validation_required",
  diagnostics }`。
- 字符串转义：agent description / generation.input / react.reason.input
  包含引号或反斜杠时正确转义。
- `max_output` 省略时 generate options 不包含该字段（reason 和 final
  都验证一遍）。
- linear / react 的空行结构符合规范。
- ReAct: `thought.<field>` 引用正确 lower 到 `thought.<field>`，
  `local.<name>` 在 act args 里正确去前缀。
- ReAct: `stop_when: "thought.done"` lower 到 `done = thought.done`。

阶段 4 的端到端测试会再用 parser/analyzer 验证 compiler 输出的语法和语义
合法性，所以本阶段只测字符串形态。

验收：

- `npm run typecheck` 通过。
- compiler 单元测试全绿。
- 已有的 linear fixture 编译输出能被 `parse()` 成功解析（不报 parse
  error）。ReAct fixture 在阶段 5 加入后同样验证。

## 阶段 4：Linear 集成测试（compile → parse → analyze）

状态：计划中。

目标：端到端验证 linear fixture 的 compiler 输出能通过现有 parser +
semantic analyzer。

新增文件：

```text
tests/architect/integration.test.ts
```

### 测试形态

```ts
import { readFileSync } from "node:fs";
import { compileSpec } from "../../src/architect/compiler/index.js";
import { asAgentSpecDraft } from "../../src/architect/spec/types.js";
import { parse } from "../../src/parser/parser.js";
import { analyze } from "../../src/semantic/analyzer.js";

describe("architect integration", () => {
  const fixtures = [
    "fixtures/architect/docs-assistant.spec.json",
    "fixtures/architect/support-agent.spec.json",
    // 阶段 5 加入 react-research-agent
    // 阶段 8 加入 research-agent (linear)
  ];

  for (const fixturePath of fixtures) {
    it(`${fixturePath} → compile → parse → analyze = no errors`, () => {
      const json = JSON.parse(readFileSync(fixturePath, "utf-8"));
      const spec = asAgentSpecDraft(json);
      expect(spec).not.toBeNull();

      const compiled = compileSpec(spec!);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      const program = parse(compiled.source);
      const result = analyze(program);
      const errors = result.diagnostics.filter(d => d.severity === "error");
      expect(errors).toEqual([]);
    });
  }
});
```

### 关键点

这个测试是 V7 的核心保证：**任何通过 validator 的 spec，compiler 产出的
源码必须通过 parser + analyzer**。如果失败说明 compiler 有 bug。

如果 analyzer 报错，常见原因：

- compiler 生成了未声明的变量引用（locals 顺序错误、ReAct 中 `thought` /
  `obs` / `scratch` / `done` 使用错位）。
- compiler 生成了不合法的 contract type。
- compiler 生成了不合法的 import URI scheme。
- compiler 生成了不合法的 generate options。
- ReAct 循环里 `loop until done max N` 的语法不对（max 必须紧跟 number）。

这些都应该在 compiler 层面修复，不应该修改 analyzer。

验收：

- 现阶段两个 linear fixture 端到端全绿。
- 后续新增 fixture 只需加入 `fixtures` 数组即可自动覆盖。

## 阶段 5：ReAct fixture 与 ReAct 端到端验证

状态：计划中。

目标：补充 ReAct fixture，验证 react lowering 端到端通过 parser +
analyzer。

新增文件：

```text
fixtures/architect/react-research-agent.spec.json
```

### react-research-agent.spec.json

最朴素的 ReAct：

- `pattern: "react"`。
- 一个 input：`question: string`。
- 一个 tool：`Search` with method `query`。
- `locals: []`（纯 ReAct，所有数据在循环里采集）。
- `model_context`：只有 `input.question` 一条（`scratch` 由 ReAct lowering
  自动 use）。
- `react.scratch`: label `"observations"`, max `"4k"`。
- `react.reason.output.fields`: `focus: string`、`done: boolean`。
- `react.act`: `Search.query({ q: "thought.focus" })`。
- `react.stop_when`: `"thought.done"`。
- `react.max_iterations`: `6`。
- `generation.input`: 让模型基于 observations 答最终问题。
- `output.fields`: `answer: string`、`citations: list[json]`、
  `confidence: number`。

具体字段填写参考 `agent-spec.md` 中 `react` 章节的示例。

### 期望生成的 `.as`

近似形态（snapshot 测试以 compiler 实际输出为准）：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Search from "mcp://search"

main agent ReactResearchAgent {
    model Qwen
    role "Research assistant"
    description "Iteratively gather evidence and answer."

    main func(input {
        question: string
    }) {
        use input.question as "research question"

        scratch = []
        use scratch.summary max 4k as "observations"
        done = false

        loop until done max 6 {
            thought = generate({
                input: "Look at the observations so far. Pick the next focused query, or set done=true if you can answer.",
                max_output: 400
            }) -> {
                focus: string
                done: boolean
            }

            obs = Search.query({
                q: thought.focus
            })
            scratch.add(obs)
            done = thought.done
        }

        return generate({
            input: "Answer the research question using only the observations.",
            max_output: 1500
        }) -> {
            answer: string
            citations: list[json]
            confidence: number
        }
    }
}
```

### 验证

把 fixture 加入阶段 4 的 `fixtures` 数组，端到端自动跑通。

新增 ReAct 专项测试 case：

- 编译输出包含 `loop until done max 6 { ... }` 结构。
- `thought = generate({...}) -> { focus, done }` contract 正确。
- `obs = Search.query({ q: thought.focus })` 引用解析正确。
- `done = thought.done` 收尾。
- `parse() + analyze()` 无 error。

验收：

- ReAct fixture 通过 validator（`ok: true`）。
- ReAct fixture 通过 compiler → parse → analyze 端到端。
- 集成测试 fixtures 数组中包含 ReAct fixture。

## 阶段 6：host://architect tool provider

状态：计划中。

目标：把 validator + compiler + analyzer 包装为 `host://architect` tool
provider，并通过默认 AgentScript tool provider 注入到 host namespace。

新增模块：

```text
src/architect/tool/provider.ts
```

修改：

```text
src/language/schemes.ts           — 新增 ARCHITECT_SCHEME 常量
src/host-tools.ts                 — 注入 ArchitectToolProvider
```

### schemes.ts

```ts
export const ARCHITECT_SCHEME = "architect";
```

### provider.ts

```ts
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { RuntimeError } from "../../runtime/errors.js";
import { asAgentSpecDraft } from "../spec/types.js";
import { validateSpec } from "../validator/index.js";
import { compileSpec } from "../compiler/index.js";
import { parse } from "../../parser/parser.js";
import { analyze } from "../../semantic/analyzer.js";

export class ArchitectToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (new URL(request.uri).pathname.replace(/^\/$/, "") !== "") {
      return {
        ok: false,
        code: "invalid_uri",
        message: "host://architect does not accept a path",
      };
    }
    switch (request.method) {
      case "validateSpec":  return this.validateSpec(request);
      case "compileSpec":   return this.compileSpec(request);
      case "analyzeSource": return this.analyzeSource(request);
      default:
        throw new RuntimeError(`Unknown Architect method '${request.method}'`);
    }
  }

  validateSpec(request: ToolCallRequest): RuntimeValue { ... }
  compileSpec(request: ToolCallRequest): RuntimeValue { ... }
  analyzeSource(request: ToolCallRequest): RuntimeValue { ... }
}
```

### 方法实现要点

`validateSpec`：

- `request.args[0]` 必须是 object（否则 hard error）。
- 取 `spec` 字段，调用 `asAgentSpecDraft(spec)`。返回 `null` 时返回
  `{ ok: false, code: "invalid_input", message: "spec must be a JSON object" }`。
- 对 draft 调用 `validateSpec(draft)`，把 `{ ok, diagnostics }` 直接 JSON
  序列化返回。

`compileSpec`：

- 同上取 `spec` 并解析为 draft。
- 调用 `compileSpec(draft)`。失败时返回
  `{ ok: false, code: "validation_required", diagnostics }`，成功时返回
  `{ ok: true, source }`。

`analyzeSource`：

- `request.args[0]` 必须是 object（否则 hard error）。
- 取 `source` 字段，必须是 string（否则 hard error）。
- 调用 `parse(source)`：parse 抛错时捕获，返回
  `{ ok: false, code: "parse_error", message: error.message,
  diagnostics: [] }`。
- 调用 `analyze(program)`，过滤 severity == "error" 的诊断。返回
  `{ ok: errors.length === 0, diagnostics: errors.map(...) }`。返回的诊断
  字段命名与 architect validator 的 `SpecDiagnostic` 保持一致结构（即
  `{ severity, code, path, message }`），但 `code` 来自 semantic analyzer，
  与 architect validator 的错误码命名空间不同。semantic diagnostics 的
  `path` 使用 `source:<line>:<column>`，因为它们定位的是生成源码，而不是
  AgentSpec JSON pointer。

### host.ts 修改

```ts
import { ARCHITECT_SCHEME, OPTIMIZER_SCHEME } from "./language/schemes.js";
import { ArchitectToolProvider } from "./architect/tool/provider.js";
import { OptimizerToolProvider } from "./optimizer/provider.js";

// createAgentScriptHostNamespaces:
return {
  [OPTIMIZER_SCHEME]: new OptimizerToolProvider({ workspaceRoot, ...optimizer }),
  [ARCHITECT_SCHEME]: new ArchitectToolProvider(),
};
```

`ArchitectToolProvider` 不需要 workspace 或 budget context，构造无参。

### 错误模型

| 边界 | 触发场景 | 处理 |
|------|---------|------|
| hard error (RuntimeError) | 未知 method、`request.args[0]` 不是 object、`analyzeSource` 的 `source` 不是 string | 抛 |
| soft error (`ok: false`) | `invalid_uri`、`invalid_input`、`validation_required`、`parse_error` | 返回结构化对象 |

### 测试

新增 `tests/architect/provider.test.ts`（或并入 integration.test.ts），
覆盖：

- `validateSpec` 对合法 spec 返回 `ok: true`。
- `validateSpec` 对非法 spec 返回 diagnostics。
- `validateSpec` 对 `spec: null` 返回 `invalid_input`。
- `compileSpec` 对合法 spec 返回 source。
- `compileSpec` 对 validation 失败返回 `validation_required`。
- `analyzeSource` 对合法 source 返回 `ok: true`。
- `analyzeSource` 对语法错误返回 `parse_error`。
- 未知 method 抛 RuntimeError。
- `host://architect/foo` 路径返回 `invalid_uri`。

验收：

- `npm run typecheck` 通过。
- `npm test` 全绿。
- `host://architect` 在 CLI 默认 tool provider 中可用。

## 阶段 7：Meta-agent 示例

状态：计划中。

目标：写一个 `examples/meta/architect.as` 示例，展示用 AgentScript 调用
`host://architect` 完成 NL → spec → validate → compile → analyze 的完整
流程。示例 prompt 让 LLM 在生成 spec 时显式选择 `pattern`（linear vs
react）。

新增文件：

```text
examples/meta/architect.as
examples/meta/README.md
```

### architect.as

按 v7-design 的"Meta-agent 示例"小节编写。关键结构：

1. `import tool Architect from "host://architect"`。
2. `use` 用户输入作为 context。
3. 第一次 `generate` 产出 AgentSpec JSON（contract 字段 `spec: json`）。
   prompt 明确："Choose pattern='linear' for single-shot RAG, or
   pattern='react' if the agent needs to iteratively decide what to fetch."
4. `Architect.validateSpec` 检查。
5. validation 失败时 `use` diagnostics，第二次 `generate` 修复 spec。
6. `Architect.compileSpec` 编译。
7. `Architect.analyzeSource` 验证生成源码。
8. 最终 `generate` 总结结果。

注意：示例必须先判断 `compiled.ok`，再读取 `compiled.source`，否则失败
分支会引用未定义字段。

### README.md

需要说明：

- 这个示例展示 AgentScript 的自举能力。
- 支持 linear 和 react 两种 pattern；LLM 会根据 user request 选择。
- `--mock` 跑通流程结构（mock LLM 返回空字段，但 tool 调用链完整）。
- 真实 LLM 跑端到端需要配置 model URI。
- 运行命令示例。

### 运行验证

```bash
# Mock 模式：linear 请求
agentscript examples/meta/architect.as --mock --input '{
  "request": "Build a docs assistant that searches documentation and returns answers with citations",
  "target_name": "DocsAssistant",
  "model_uri": "ollama://localhost:11434/qwen3.6"
}'

# Mock 模式：react 请求
agentscript examples/meta/architect.as --mock --input '{
  "request": "Build a research agent that iteratively searches and gathers evidence before answering",
  "target_name": "ResearchAgent",
  "model_uri": "ollama://localhost:11434/qwen3.6"
}'
```

Mock 模式下：

- `generate` 返回空字段（`spec: {}`、`assumptions: []` 等）。
- `Architect.validateSpec` 返回 `{ ok: false, diagnostics: [...] }`（mock
  spec 缺必填字段）。
- 整个流程不崩溃，因为示例里有 `if not validation.ok` 和 `if compiled.ok`
  的分支。
- 最终返回 summary（字段为空字符串/空列表）。

这证明 meta-agent 的**结构正确性**：即使 LLM 返回垃圾，tool 调用链和条件
分支仍然正确执行。

验收：

- `agentscript examples/meta/architect.as --mock --input '...'` 跑完不
  崩溃。
- `agentscript examples/meta/architect.as --check` 通过 semantic analysis。
- README 说明清晰。

## 阶段 8：Architect CLI

状态：计划中。

目标：实现 `agentscript architect` 子命令，作为用户直接使用 V7 的 CLI
入口。CLI 复用 `host://architect` 背后的 validator / compiler / analyzer
逻辑，但负责参数解析、文件读写、自然语言入口和退出码。

命令形态：

```bash
agentscript architect "build a docs assistant..." my_first_agent.as
agentscript architect "build a docs assistant..." my_first_agent.as --model ollama://localhost:11434/qwen3.6
agentscript architect --spec agent.spec.json my_first_agent.as
agentscript architect --check agent.spec.json
```

新增/修改文件：

```text
src/bin/args.ts              — 识别 architect 子命令及其参数
src/bin/agentscript.ts       — 分发到 architect runner
src/bin/architect.ts         — 新增：architect CLI runner
tests/cli.test.ts            — architect CLI 覆盖
```

### 参数语义

- `agentscript architect "<request>" <output.as>`：
  - 使用内置 meta-agent 或等价流程将自然语言 request 转成 AgentSpec draft。
  - validate → repair（可选）→ compile → analyze。
  - analyze 成功后写出 `<output.as>`。
  - 支持 `--model <uri>`，作为 meta-agent 生成 AgentSpec 时传入的 preferred
    model URI。默认值为 `ollama://localhost:11434/qwen3.6`。
  - 支持 `--mock`，但 `--mock` 只证明流程结构，不保证生成可用 agent。
- `agentscript architect --spec <spec.json> <output.as>`：
  - 读取 JSON 文件。
  - validate → compile → analyze。
  - analyze 成功后写出 `<output.as>`。
- `agentscript architect --check <spec.json>`：
  - 只运行 validator。
  - 有 error 时退出非零。
  - 不写文件。

### 错误与退出码

- spec 文件无法读取或 JSON.parse 失败：打印错误，退出非零。
- validate 有 error：打印 diagnostics，退出非零。
- compile 失败：打印 diagnostics，退出非零。
- analyze 失败：打印 parse/semantic diagnostics，退出非零。
- 输出文件只在 validate/compile/analyze 全部成功后写入。

### 测试

`tests/cli.test.ts` 增加：

- `agentscript architect --check fixtures/architect/docs-assistant.spec.json`
  返回 0。
- `agentscript architect --spec fixtures/architect/docs-assistant.spec.json out.as`
  写出可 parse/analyze 的 `.as`。
- invalid spec `--check` 返回非零，输出 diagnostics。
- 自然语言入口在 `--mock` 下能跑通流程结构；如果 mock spec 无法通过
  validate，应返回结构化错误而不是崩溃。

验收：

- 三种命令形态都被测试覆盖。
- 输出文件的内容通过 parser/analyzer。
- 失败路径不会写半成品文件。

## 阶段 9：第 4 个 fixture（research-agent，linear）

状态：计划中。

目标：补充 research-agent linear 样例，验证 schema 对不同 agent kind 的
覆盖度，并让总 fixture 数量达到 3 linear + 1 react。

新增文件：

```text
fixtures/architect/research-agent.spec.json
```

形状要点（具体字段以 `agent-spec.md` 的字段约束为准）：

- `pattern: "linear"`（与 ReAct 版区分）。
- 两个 tool：`Search`、`Extract`。
- 两个 local：`search_results`（依赖 `input.question`）、`evidence`
  （依赖 `local.search_results`）。
- 三条 model_context（question + search_results + evidence）。
- 输出包含 `uncertainty` 和 `followups` 等典型 research agent 字段。
- 用 `anthropic://` URI 验证 compiler 对不同 model URI 的处理。

验收：

- 通过 validator（`ok: true`）。
- 通过 compiler → parse → analyze 端到端。
- 集成测试自动覆盖（加入 fixtures 数组）。

## 阶段 10：文档更新

状态：计划中。

目标：更新项目文档，记录 V7 新增能力。

修改文件：

```text
CHANGELOG.md                    — V7 条目
README.md                       — feature list 追加 architect toolchain
docs/cn/language.md             — host tool URI scheme 表追加 host://architect
docs/en/language.md             — 同上
examples/meta/README.md         — meta-agent 使用说明（阶段 7 已建）
```

### CHANGELOG 条目

```markdown
## 0.1.21

### Added

- AgentSpec JSON format for structured agent design with two patterns
  (`linear` and `react`); see
  [`docs/en/agent-spec.md`](./docs/en/agent-spec.md) /
  [`docs/cn/agent-spec.md`](./docs/cn/agent-spec.md).
- `host://architect` tool with three methods:
  - `Architect.validateSpec` — validate AgentSpec structure and references.
  - `Architect.compileSpec` — deterministic compilation to AgentScript
    source (linear or ReAct lowering).
  - `Architect.analyzeSource` — verify generated source with parser/analyzer.
- Meta-agent example (`examples/meta/architect.as`) demonstrating self-hosted
  agent generation across both patterns.
- `agentscript architect` CLI for natural-language generation, spec
  compilation, and spec checking.
- `agentscript architect --model <uri>` to choose the model URI passed to the
  meta-agent.
- Four AgentSpec fixture examples: docs-assistant, support-agent,
  research-agent (linear), and react-research-agent (react).
```

### README 追加

在 "Currently implemented" 列表加一行：

```text
- AgentSpec → AgentScript deterministic compiler (`host://architect`,
  supports linear RAG and ReAct patterns)
- `agentscript architect` CLI for compiling/checking AgentSpec and generating
  agents from natural-language requirements
- `--mock` keeps built-in `host://` tools live while mocking external tools,
  so architect/optimizer workflows can validate their toolchain path locally.
```

在 examples 介绍处追加：

```text
- `examples/meta/` contains a meta-agent that generates AgentScript agents
  from natural-language requirements using `host://architect`. Both linear
  and ReAct patterns are supported.
```

### language.md 修改

`docs/cn/language.md` 和 `docs/en/language.md` 在 host tool URI scheme 表中
添加：

```text
| `host://architect` | 内置 AgentSpec compiler toolchain | `host://architect` |
```

并在"相关设计文档"小节追加 agent-spec.md 链接（已在前面工作中完成）。

验收：

- 文档准确反映实现状态。
- 无拼写错误。
- 链接有效。

## 实施顺序建议

推荐顺序：

1. **阶段 0**：类型定义（含 pattern discriminated union）。必须先行。
2. **阶段 1**：Linear fixture 样例。验证类型设计是否够用。
3. **阶段 2**：Validator（含 pattern check 与 react check）。
4. **阶段 3**：Compiler（按 pattern 分发，先 linear 后 react）。
5. **阶段 4**：Linear 集成测试。
6. **阶段 5**：ReAct fixture 与端到端验证。
7. **阶段 6**：Tool provider + host 注册。
8. **阶段 7**：Meta-agent 示例。
9. **阶段 8**：Architect CLI。
10. **阶段 9**：第 4 个 fixture（research-agent linear）。
11. **阶段 10**：文档。

阶段 0-5 是核心链路，必须串行（5 必须在 3 完成 react 部分之后）。阶段 6-10
可以在核心链路稳定后并行推进。

实务上阶段 2 和 3 可以交叉开发：validator 的每个 check 模块完成后，
compiler 可以立即开始对应的 lowering 实现。compiler 内部建议先把 linear
emitter 跑通（阶段 4 端到端验证），再上 react emitter（阶段 5 端到端
验证），降低同时调试两条 lowering 路径的复杂度。

## 风险与取舍

### compiler 生成的源码不通过 analyzer

风险：compiler 的 lowering 规则与当前 AgentScript 语法有细微不匹配，导致
生成的源码有 semantic error。

处理：

- 集成测试（阶段 4 与阶段 5）是核心防线。每个 fixture 都必须端到端通过。
- 如果 analyzer 报错，修 compiler，不修 analyzer。
- 常见陷阱：
  - `generate` 的 `max_output` 必须是 number，不能是 string。
  - contract type `list[json]` 的方括号不能有空格。
  - `use` 的 budget 格式必须是 `max <number><unit>`，不能有空格。
  - import URI 必须用双引号。
  - agent name 必须以大写字母开头。
  - ReAct: `loop until done max N` 中 `max` 必须紧跟正整数；max
    iterations 是 spec 显式声明的，validator 已保证类型。
  - ReAct: `thought` / `obs` / `scratch` / `done` 是循环 scope 内 compiler
    保留的标识符。validator 拒绝 spec 把它们作为 args expression 的 root
    （除 `thought.` 之外的形式），这是为了避免循环体里出现意外的标识符
    冲突。

### ReAct lowering 的标识符冲突

风险：用户在 spec 里给 input、local 起名 `thought` / `obs` / `scratch` /
`done`，导致 ReAct 循环体里 compiler 生成的标识符与 outer scope 同名变量
冲突。

处理：

- validator 对 ReAct spec 显式禁用这四个名字作为 `inputs` key 和
  `locals[*].name`，因为它们会成为 runtime binding。contract field name
  不能是 `thought`、`obs` 或 `scratch`；`done` 允许出现，因此
  `thought.done` 作为 `stop_when` 是合法形态。错误码 `RESERVED_IDENTIFIER`。
- 错误信息明确给出冲突原因和建议替换。
- linear pattern 不受此限制（不会进入 ReAct lowering）。

### LLM 生成的 AgentSpec 质量不可控

风险：meta-agent 示例中 LLM 生成的 spec JSON 可能不合法。

处理：

- 这不是 toolchain 的问题。toolchain 只保证"合法 spec → 合法源码"。
- meta-agent 示例中有 validate → repair 的条件分支，展示了处理方式。
- `--mock` 模式下 LLM 返回空值，tool 调用链仍然完整执行，证明结构正确。
- 真实 LLM 的 prompt engineering 是 Phase 2 的工作。

### AgentSpec schema 可能不够表达

风险：4 个 fixture 覆盖的场景有限，实际使用中可能发现 schema 不够用。

处理：

- Phase 1 明确支持两种 pattern：`linear` 和 `react`。其他 agent pattern
  （Plan-Execute、Reflection、通用 stages）通过 Phase 2 增加新 pattern
  来扩展。
- 不支持条件分支、嵌套循环、多函数、多 agent。具体限制见 `agent-spec.md`
  的"限制"小节。
- 如果发现需要扩展，在 Phase 2 中增加 pattern 或字段，保持向后兼容（新
  pattern 是 additive；新字段 optional）。
- `version: "0.1"` 为未来 schema 升级预留空间。
- `pattern` 字段是核心扩展点：未知 pattern 直接返回 `UNSUPPORTED_PATTERN`
  诊断，所以引入新 pattern 不会让旧 validator 误判。

### host://architect 与 host://optimizer 的命名边界

风险：两个 host tool 都操作 AgentScript 源码，用户可能混淆职责。

处理：

- `host://architect` 的方法名使用 camelCase（`validateSpec`、`compileSpec`、
  `analyzeSource`），与 `host://optimizer` 的方法名（`inspect`、`trial`、
  `specialize`）完全不同。
- URI scheme 不同：`host://architect` vs `host://optimizer`。
- 在 `.as` 中 import 名不同：`Architect` vs `Optimizer`。
- 不保留旧名；冷启动阶段统一使用 `host://optimizer`。

### 零依赖约束

风险：validator 和 compiler 可能需要 JSON schema 验证库。

处理：

- 不引入外部 JSON schema 库。validator 手写类型检查。
- 这些检查逻辑简单（字段存在性、正则匹配、集合查找），不需要通用 schema
  验证器。
- 保持零运行时依赖。

## 完成标准

V7 Phase 1 完成时应满足：

- `src/architect/` 目录结构完整：spec / validator / compiler / tool 四个
  子模块。
- AgentSpec `pattern` 字段可识别 `"linear"` 与 `"react"`，未知 pattern
  返回 `UNSUPPORTED_PATTERN` 诊断。
- `host://architect` 三个方法可用，入参/返参 schema 稳定。
- `agentscript architect` 三种命令形态可用。
- 4 个 fixture spec（3 linear + 1 react）全部通过 validate → compile →
  parse → analyze 端到端。
- meta-agent 示例 `--mock` 模式跑通不崩溃；prompt 让 LLM 在 linear 与
  react 之间选择。
- meta-agent 示例 `--check` 通过 semantic analysis。
- `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build`
  全部通过。
- 现有测试无回归。
- CHANGELOG、README、language.md 更新到位。
- 不新增 runtime npm dependency。
