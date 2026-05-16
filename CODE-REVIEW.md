# AgentScript 源码组织审查 (src/)

> 审查范围：`src/` 全部 TypeScript 源码（约 11.8k 行 / 139 文件）
> 审查日期：2026-05-16
> 审查重点：模块组织、过度设计、简化过度

## 1. 总体评价

整体上这是一份相当克制、风格一致的代码库：分层清晰（`ast` → `parser`/`semantic` → `runtime` ← `providers`），层与层之间的 import 方向几乎没有逆流，AST 类型集中定义在 `src/ast/types.ts` 一处。零运行时依赖、纯函数式诊断收集、`SchemeToolProvider` 这类小而正交的抽象都体现了"最小化"的设计取向。

主要风险集中在三处：
1. **同名概念在 4–5 个层各有一份文件** —— `contract`、`generate*`、`parallel-for` 文件名跨层重复，乍看像是重复实现；实际上各自承担合理的不同职责，但缺乏命名上的区分，新读者很难一眼看清。
2. **`runtime/` 目录像一个"什么都往里放"的口袋** —— 32 个文件混合了核心解释器、值/类型 utilities、JSON marshal、host 适配、context 编排、generate 流水线等多类职责，最大的 `interpreter.ts` (454 行) 还要协调 evaluator + generate + provider 实例化。
3. **`semantic` 反向依赖 `providers/tools/npm-registry`** —— 唯一一条明显的"语义层调用 provider 层"的越界 import，应当下沉到 `language/` 或反过来由调用者注入。

下面按严重度展开。

## 2. 模块结构概览

```
src/
├── ast/              AST 类型 + 子表达式遍历 + 反序列化（formatExpressionSource）
├── parser/           tokenizer + 递归下降 parser + 子语法（contract/generate/control-flow/literals/parallel-for）
├── semantic/         诊断收集器：每个语法构造一个 collect*Diagnostics(...) 文件
├── language/         parser/semantic/runtime 三层共享的领域知识（contract 类型表、binding 类型表、URI scheme 常量、site-id、source-map、variant-sites）
├── runtime/          解释器/求值器、scope、context 构建与裁剪、generate 流水线、provider marshal、loader
├── providers/        llm/memory/tools/mock/dry-run；shared/workspace 给 file/shell 用
├── optimizer/        host://optimizer 工具实现 + 源码改写
├── architect/        AgentSpec → AgentScript 编译器 + 校验器 + host://architect 工具
├── bin/              CLI 入口、REPL、参数解析
├── utils/            location 字符串化（仅 1 个文件）
└── index.ts          公共 API 再导出
```

| 目录 | 职责 | 大小 |
|---|---|---|
| `ast/` | 类型与遍历 | 3 文件 / ~370 行 |
| `parser/` | 词法/语法 | 13 文件 / ~1.4k 行 |
| `semantic/` | 静态检查 | 14 文件 / ~1.4k 行 |
| `language/` | 跨层共享语言常量与 utilities | 13 文件 / ~480 行 |
| `runtime/` | 解释器与求值 | 32 文件 / ~3.2k 行 |
| `providers/` | LLM/Memory/Tool 适配器 | 30 文件 / ~2.6k 行 |
| `optimizer/` | 源码重写工具 | 2 文件 / ~691 行 |
| `architect/` | spec→source | 17 文件 / ~1.1k 行 |
| `bin/` | CLI/REPL | 9 文件 / ~1k 行 |

## 3. 主要问题

按严重度从高到低排列。

### 3.1 `runtime/` 目录是一个混合口袋

- **类型**：组织不合理
- **位置**：`src/runtime/`（32 个文件）
- **现状**：当前 `runtime/` 同时容纳了至少 5 类不同职责：
  - **解释器核心**：`interpreter.ts`、`evaluator.ts`、`scope.ts`、`operators.ts`、`truth.ts`、`agents.ts`、`paths.ts`
  - **类型与值层**：`types.ts`、`guards.ts`、`json.ts`、`json-walk.ts`、`disposable.ts`、`host-marshal.ts`
  - **Generate 流水线**：`generate.ts`、`generate-options.ts`、`generate-debug.ts`、`generate-repair.ts`、`schema-defaults.ts`、`contract.ts`、`contract-schema.ts`
  - **Context 构建/裁剪/渲染**：`context.ts`、`context-clip.ts`、`context-render.ts`、`use-one-of.ts`
  - **Trace + provider 调度**：`trace.ts`、`trace-event.ts`、`resource-calls.ts`
  - **Loader/Imports/Input**：`loader.ts`、`imports.ts`、`input.ts`、`parallel-for.ts`
- **影响**：导致两类问题：
  - 阅读困难。`runtime/types.ts` 同时定义了 JSON 类型、Resource binding、Provider 接口、Trace 事件，是事实上的"runtime 万能 types"。
  - 边界模糊。`json-walk.ts` 提供的访问器既被 `json.ts`（运行时 sanitize）、又被 `host-marshal.ts`（provider 边界 marshal）使用，这两个用例在模块树上没有公共上层，靠平铺在 `runtime/` 目录共享。
- **建议**：在 `runtime/` 内部按职责分子目录而不是新增层：
  ```
  runtime/
    core/          interpreter.ts, evaluator.ts, scope.ts, operators.ts, truth.ts, ...
    values/        types.ts (拆分), guards.ts, json.ts, json-walk.ts, host-marshal.ts
    generate/      generate.ts, generate-options.ts, generate-debug.ts, generate-repair.ts, schema-defaults.ts
    context/       context.ts, context-clip.ts, context-render.ts, use-one-of.ts
    contract/      contract.ts, contract-schema.ts, input.ts
    program/       loader.ts, imports.ts, paths.ts, agents.ts
    trace/         trace.ts, trace-event.ts, resource-calls.ts, parallel-for.ts
  ```
  分子目录后 `interpreter.ts`、`evaluator.ts` 仍然是入口，但同时减小了"runtime 入门"的认知负担。

### 3.2 `semantic` 反向依赖 `providers/tools/npm-registry`

- **类型**：组织不合理（模块边界泄漏）
- **位置**：
  - `src/semantic/analyzer.ts:3` 导入 `NpmRegistry` 类型
  - `src/semantic/program.ts:6` 导入 `checkNodeImport`、`checkNpmImport`、`NpmRegistry`
  - `src/bin/semantic.ts:4` 导入 `loadNpmRegistry` 用于 CLI 注入
- **现状**：`semantic/` 直到 `program.ts:64-79` 都依赖 `providers/tools/npm-registry.ts` 来检查 `npm://` / `node://` import 是否在白名单内。这是源码里**唯一**一条 semantic→providers 的反向 import：
  ```typescript
  import { checkNodeImport, checkNpmImport, type NpmRegistry } from "../providers/tools/npm-registry.js";
  ```
- **影响**：
  - 概念上 `semantic` 是 parser 的下游、runtime 的上游，应当不依赖任何 provider。
  - `npm-registry.ts` 同时被 `providers/tools/host.ts`、`providers/tools/node.ts`、`providers/tools/npm.ts`、`providers/dry-run/tool.ts`、`semantic/program.ts`、`bin/semantic.ts` 使用，事实上是个跨层的"权限白名单"模块。
- **建议**：把 `npm-registry.ts` 拆分为：
  - `language/npm-registry.ts`：纯数据加载 + `checkNpmImport` / `checkNodeImport`（这是规则）
  - `providers/tools/npm-registry-runtime.ts`（可选）：跑时的 cache/IO（如果有）
  
  或者更简单：把 `npm-registry.ts` 整个迁到 `language/`，因为它既不知道 `RuntimeValue`、也不知道 `ToolProvider`，只读 `agentscript.npm.json`。这样 semantic 的依赖方向重新归零。

### 3.3 `parser/parallel-for.ts` 与 `runtime/parallel-for.ts` 与 `semantic/parallel-for.ts` 的命名风险

- **类型**：组织不合理（命名）
- **位置**：
  - `src/parser/parallel-for.ts` (14 行)：解析语法
  - `src/semantic/parallel-for.ts` (104 行)：检查并行体内的副作用
  - `src/runtime/parallel-for.ts` (138 行)：运行时调度执行
- **现状**：三层都有同名文件。它们职责完全正交，并不重复——但仅看文件名无法分辨。`contract.ts`（`parser`/`semantic`/`runtime`/`language` 各一份）、`generate*` 系列也是同样的模式。
- **影响**：
  - 同名文件分布在 4 个目录，IDE 全局搜索 `parallel-for.ts` 会同时跳出多个，认知开销集中在"不要走错门"上。
  - 风险：未来若某层引入第二个 `*.ts`，更难辨别。
- **建议**：保持每层一份的"层间镜像"模式，但**统一命名前缀**或**只在重复的语法构造上保留这种镜像**：
  - parser：`parser/parse-parallel-for.ts`、`parser/parse-contract.ts`、`parser/parse-generate.ts`
  - semantic：`semantic/check-parallel-for.ts`、`semantic/check-contract.ts`、`semantic/check-generate.ts`
  - runtime：`runtime/eval-parallel-for.ts`（或归到 `runtime/parallel-for/index.ts`）
  
  这是一个低代价、信息含量高的重命名。语义不变，但在导入语句里能立刻看出层归属。

### 3.4 `interpreter.ts` 既是协调器又是工厂、还是 declareUse 的执行体

- **类型**：简化过度（单文件混合多种职责）
- **位置**：`src/runtime/interpreter.ts`（454 行，最大文件）
- **现状**：`Interpreter` 类承担了：
  - 提供商默认值与 disposable 清理（`execute` 方法 + `closeIfDisposable` 辅助 helper，行 81–94 / 444–455）
  - Evaluator 的工厂 + 回调闭包（`createEvaluator`，行 142–172，使用 `let evaluator: Evaluator;` + 后向引用是经典的"先声明后赋值"绕环依赖）
  - 函数调用栈管理（`callFunction`、`maxCallDepth`，行 119–141）
  - 完整的 `executeStatement`/`executeBlock`（行 230–325，包含 if/for/loop/repeat/return 全部分支）
  - `declareUse` / `declareUseOneOf` / `useOneOfSiteId`（行 376–435，处理变体站点 + 默认 siteId 计算回退）
- **影响**：
  - `createEvaluator` 里的循环依赖（evaluator 调用回 `evaluateBlockFinalValue`，后者又用 `createEvaluator` 起一个新 evaluator）使得 Evaluator 与 Interpreter 实际上是耦合的——但目前用 host 接口假装是解耦的。
  - 默认 fallback 的 `siteId` 计算（行 432–435）和 `language/site-id.ts` 的 `buildSiteId` 用了不同的格式，是个隐藏的不一致点。
- **建议**：
  - 把 `executeStatement` 的 `switch (stmt.kind)` 分支抽到 `runtime/statements.ts`（每种语句一个 evaluator），或者放到 Evaluator 里（`evaluateStatement`）让 Evaluator 真正是"执行 AST 的对象"，Interpreter 只剩下生命周期与调用栈管理。
  - `createEvaluator` 里的循环引用如果保留，应当在注释里写明动机；或者改成把 Evaluator 改造成"从外部传入 host"的纯类，由 Interpreter 在创建后注入 host。
  - `useOneOfSiteId` 的 fallback 应该统一调用 `language/site-id.ts:buildSiteId`，避免两套格式（`<source>:<line>:<col>` vs `<path>#<scope>[<label>]`）。

### 3.5 `optimizer/provider.ts` 在一个文件里塞下了 5 件事

- **类型**：组织不合理（文件粒度）
- **位置**：`src/optimizer/provider.ts`（441 行，第二大文件）
- **现状**：单个 `OptimizerToolProvider` 类 + 17 个顶层 helper 实现了：
  - `inspect` / `trial` / `specialize` 三个方法分发
  - 选择校验（`readSelection` / `validateSelection`）
  - entry 校验（`readEntry` / `validateEntry`）
  - graph 哈希快照（`snapshotGraph` / `normalizeSource`）
  - trace 收集（`pickedVariants` / `flattenTrace` / `countEvents`）
  - effectful tool 警告（`isTargetEffectfulToolImport` / `targetEffectfulToolWarnings`）
  - trial 跟踪文件落盘（`writeTrialTrace`）
  - JSON 序列化（`siteToJson` / `baselineSelection`）
- **影响**：所有 helper 共享 `ctx.workspaceRoot` 等全局上下文，但分散在 441 行里，扩展某个方法需要在文件里反复跳转。`flattenTrace` 那两个 `as unknown as TraceEvent[]` 强转（行 422、427）也提示 trace 类型设计不够稳。
- **建议**：拆为 4 个文件，方法按动词分组：
  ```
  optimizer/
    provider.ts           OptimizerToolProvider 类 + 调度
    inspect.ts            inspect(...) + sites / warnings
    trial.ts              trial(...) + budget + trace 写盘
    specialize.ts         specialize(...) (rewriteGraph 已经在 source-rewrite.ts)
    snapshot.ts           snapshotGraph + normalizeSource + normalizePath
    selection.ts          readSelection / validateSelection / readEntry / validateEntry
  ```
  每文件 50–120 行，单个方法的依赖清晰。

### 3.6 Generate 流水线被切成 5 个文件略显过散

- **类型**：组织不合理（文件粒度过细）
- **位置**：
  - `src/runtime/generate.ts` (262 行)：主流程
  - `src/runtime/generate-options.ts` (51 行)：解析 options
  - `src/runtime/generate-debug.ts` (15 行)：写调试日志（仅 1 个函数）
  - `src/runtime/generate-repair.ts` (50 行)：重试时拼接错误信息
  - `src/language/generate-options.ts` (135 行)：选项 schema + 校验规则（被 parser/semantic/runtime 共用）
  - `src/semantic/generate.ts` (50 行)：调用 `language/generate-options` 收集诊断
- **现状**：6 个文件围绕 `generate` 表达式，每个都不大，但 `generate-debug.ts` 只有一个 14 行函数，`generate-options.ts` (runtime) 也只有一个公共函数。`generate-repair.ts` 与 `generate.ts` 紧耦合（仅被 `generate.ts` 引用）。
- **影响**：
  - 阅读"generate 流水线"必须在 6 个文件之间跳转。
  - `generate-debug.ts` 单函数文件不必要。
- **建议**：
  - 合并 `generate-debug.ts`、`generate-repair.ts` 进 `runtime/generate.ts`（或把它们改为 `generate/debug.ts`、`generate/repair.ts` + `generate/index.ts` 的子目录结构）。
  - 保留 `language/generate-options.ts` 与 `runtime/generate-options.ts` 的分层（前者是规则，后者是异步求值），但建议 `runtime/generate-options.ts` 改名为 `runtime/resolve-generate-options.ts` 以体现"求值"语义，避免与 `language/generate-options.ts` 混淆。

### 3.7 `bin/agentscript.ts` 把 CLI、optimizer 子命令、budget 类、provider 工厂全压在一个文件

- **类型**：组织不合理（文件职责）
- **位置**：`src/bin/agentscript.ts` (289 行)
- **现状**：单文件混合了：
  - `main` 调度（行 12–73）
  - `runOptimizer` 子命令（行 75–127）
  - `BudgetCounter` 工厂 + `BudgetedLlmProvider` 类（行 134–179）
  - `runParse` / `runCheck` / `runAgent`（行 181–225）
  - 4 个 provider 工厂（行 227–243）
  - 终端 input provider（行 263–271）
  - 包版本读取与 entry point 检测（行 273–289）
- **影响**：与 `runArchitect` 已经被拆到 `bin/architect.ts` 不同，optimizer 子命令仍然嵌在主入口里。`BudgetedLlmProvider` 是一个 framework 抽象，却生活在 CLI 文件里。
- **建议**：
  - 把 `runOptimizer` + `createBudgetCounter` + `BudgetedLlmProvider` 抽到 `bin/optimizer.ts`，与 `bin/architect.ts` 对称。
  - 或者把 `BudgetedLlmProvider` 下沉到 `optimizer/budget.ts` —— 它本质上是 optimizer 的实现细节，CLI 只是配置入口。
  - `bin/agentscript.ts` 收缩到 100 行内，只做"解析参数 + 分发到 5 个子命令文件"。

### 3.8 `architect/` 与 `optimizer/` 提供 host:// 工具，但路径布局不对称

- **类型**：组织不合理
- **位置**：
  - `src/optimizer/provider.ts` 实现 `host://optimizer` 工具
  - `src/architect/tool/provider.ts` 实现 `host://architect` 工具
  - `src/providers/tools/host.ts:14-15` 都用 `from "../../optimizer/..."` 反向 import
- **现状**：optimizer 和 architect 是逻辑上的同一类东西（host:// 提供商），但文件布局不同：
  - `optimizer/provider.ts`：实现都在一个文件
  - `architect/tool/provider.ts`：放在 `architect/tool/` 子目录
- **影响**：`providers/tools/host.ts` 必须从 `../../optimizer/`、`../../architect/` 反向 import，事实上 providers 层依赖 optimizer/architect 层。这与"providers 是底层适配"的直觉相反。
- **建议**：倒过来——让 `providers/tools/host.ts` 接受外部注入的 `host://` 提供商映射，由 CLI/runtime 根据需要装配 OptimizerToolProvider/ArchitectToolProvider。`HostToolProvider` 不再硬编码具体子工具：
  ```typescript
  export class HostToolProvider extends SchemeToolProvider {
    constructor(workspaceRoot: string, hostNamespaces: Record<string, ToolProvider> = {}) { ... }
  }
  ```
  CLI 显式传入 `{ optimizer: new OptimizerToolProvider(...), architect: new ArchitectToolProvider() }`。这样 providers 层不再依赖任何上层模块，依赖方向就规整了。

### 3.9 `architect/validator/` 与 `semantic/` 是两套互不感知的诊断收集器

- **类型**：组织不合理（合理的近似重复）
- **位置**：
  - `semantic/`：14 个 `collect*Diagnostics(...)` 函数（针对 AgentScript 源码）
  - `architect/validator/`：8 个 `check*(spec)` 函数（针对 AgentSpec JSON）
- **现状**：两套都使用 "收集 → 数组合并" 的模式，但：
  - `semantic` 用 `SemanticDiagnostic { severity, code, message, range }`（带 SourceRange）
  - `architect/validator` 用 `SpecDiagnostic { severity, code, path, message, suggested_fix? }`（带 JSON Pointer）
  - 两者各自有 `error()` helper（`semantic/diagnostics.ts:errorDiagnostic` vs `architect/validator/helpers.ts:error`）
- **影响**：
  - 二者的差异是真实的（一个是 AST 源码定位，一个是 JSON 结构定位），所以差异性合理。
  - 但 `analyzeSource` (`architect/compiler/analyze.ts:30-35`) 把 `SemanticDiagnostic` 转成 `SpecDiagnostic`，丢失 `code/range/severity` 的精度，转换路径是 `source:<line>:<col>`，与 `path: "/x/y/z"` 在同一个 schema 字段里出现。
- **建议**：保持两套独立，但抽出一个微小的 `diagnostic-base` 共享 type：
  ```ts
  // language/diagnostic.ts
  export interface DiagnosticBase {
    severity: "error" | "warning";
    code: string;
    message: string;
  }
  ```
  让 `SemanticDiagnostic` 和 `SpecDiagnostic` 都 extends 它。这样 `analyzeSource` 转换时只需补 `path` 字段，意图清晰。

### 3.10 `parser/contract.ts` 暴露 `ContractBlockEntry<T>` 这个泛型给上层用——但只有 1 个调用方走泛型分支

- **类型**：过度设计（泛型抽象 + 单一使用）
- **位置**：`src/parser/contract.ts:18-58`
- **现状**：`parseContractBlock` 是一个泛型函数 `<T extends { range: SourceRange }>`，它只被两个地方调用：
  - `parseContractObject` 内部，T = `ContractTypeExpr`
  - `parser/parser.ts:124-131`（parseUseOneOf），T = `Omit<UseOneOfCandidate, "kind" | "name">`
- **影响**：
  - 复用是真实的（解析 `{ ... }` 内一组带 label 的 entry），但泛型签名 + `parseValue` / `parseDefaultValue` / `parseLabelOnlyContractBlockEntry` 加在一起 90 多行，比两份重复的代码（每份 30 行）更难读。
  - 函数签名 `parseContractBlock<T>(parser, options): { entries, range }` 隐藏了"contract 块"和"use one of 候选块"在语义上是两件不同的事情。
- **建议**：保持泛型框架但**把 `parser/contract.ts` 改名为 `parser/labelled-block.ts`** —— 它解析的是"一组带名字、可选值的 entry，用换行分隔"，contract 字段和 use one of 候选都符合这个模式。然后 `parser/contract.ts` 只导出 `parseContractObject` 一个函数。

### 3.11 `runtime/types.ts` 承担过多类型职责

- **类型**：组织不合理（单文件多职责）
- **位置**：`src/runtime/types.ts`（126 行，但包含 16 个公开 type/interface）
- **现状**：单文件混合了：
  - JSON 类型 (`JsonPrimitive` / `JsonValue` / `JsonObject`)
  - 5 种 binding 类型（`ToolBinding` / `LlmBinding` / `FunctionBinding` / `AgentBinding` / `MemoryBinding`）
  - `RuntimeObject` / `RuntimeValue` 与 `RuntimeResource` 联合
  - `ContextUse` (生成阶段)
  - `GenerateRequest`（provider IO）
  - `ToolCallRequest` / `MemoryAddRequest` / `MemoryQueryRequest`
  - `LlmProvider` / `ToolProvider` / `MemoryProvider` / `InputProvider` / `InputRequest`
  - `TraceEvent`
- **影响**：
  - 这个文件被 `package.json` exports 字段直接发布为 `@rong/agentscript/runtime/types`，是事实上的"runtime 公共类型"——**其中一半是 provider 协议，跟 runtime 内部表达无关**。
  - 用户引用 `RuntimeValue` 和 `LlmProvider` 是两件不同的事情，但都从同一个文件里出来。
- **建议**：在保持公开导出向后兼容的前提下，把 types.ts 内部重新组织：
  - `runtime/values.ts`：JSON、Binding、RuntimeValue
  - `runtime/providers.ts`：4 个 Provider + 4 个 Request
  - `runtime/trace.ts`（已经存在，只多一个 type）：TraceEvent
  - `runtime/types.ts` 仅 `re-export` 三者，保持 `package.json` exports 不变。

### 3.12 `Architect` CLI 的 `request` 模式硬编码了一个内置 `.as` 文件路径

- **类型**：简化过度（隐藏的运行时假设）
- **位置**：`src/bin/architect.ts:39`
  ```ts
  const sourcePath = "examples/meta/architect.as";
  ```
- **现状**：`architect "<request>" output.as` 子命令的实现方式是：把 request 当 input 喂给 `examples/meta/architect.as` 这个 agent 来执行。这个路径是相对 cwd 的硬编码。
- **影响**：
  - 用户在任何不是仓库根的地方运行 `agentscript architect "..." out.as` 都会失败（因为 `examples/meta/architect.as` 找不到）。
  - 这个文件是不是 npm 发布到用户机器上的 `dist/`？查 `package.json` 的 `files` 字段是 `["dist", "examples", ...]`，`examples` 确实会发布——但 `process.cwd()` 不一定是包目录。
- **建议**：用 `fileURLToPath(import.meta.url)` 解析到包内部相对路径（参考 `bin/agentscript.ts:273-277` 的 `readPackageVersion`），让它独立于 cwd。或者把这个 .as 改成 TS 字符串嵌入，避免运行时 IO。

## 4. 次要问题与改进建议

- **`utils/location.ts` 只有一个文件 9 行** —— `formatSourceLocation`/`formatSourceRangeStart` 完全可以放到 `ast/types.ts` 旁边一个 `ast/format-location.ts`（或者 `language/`）。`utils/` 这个目录目前只是为了放一个 helper。
- **`language/anonymous.ts` 只有 2 行 2 个常量** —— 可以并入 `language/entry.ts`（它也处理 main agent / main func 的逻辑）。
- **`parser/parallel-for.ts` 14 行** —— 可以并入 `parser/control-flow.ts`（已经放了 for/loop/repeat/if）。`parser/for-tail.ts` 24 行同理。
- **`parser/tokens.ts` 9 行 2 个 helper** —— `isNewLineBetween` / `isOnSameLine` 应该定义在 `parser/tokenizer.ts` 里（Token 已在那里），减少一个文件。
- **`runtime/context-render.ts` 5 行** —— 一个 `renderJson` 函数 5 行，可以并入 `runtime/json.ts`。
- **`runtime/disposable.ts` 7 行** —— 同上，可并入 `runtime/types.ts` 的 provider 部分（provider 接口们已经声明了 `close?(): void | Promise<void>`）。
- **`runtime/trace-event.ts` 9 行 1 个函数** —— 并入 `runtime/trace.ts`（reader 与 builder 在一起更对称）。
- **`architect/spec/schema.ts` 5 行 2 行运行时代码** —— 仅仅是 `parseAgentSpecDraft` 这一函数，可以并入 `architect/spec/types.ts` 或 `architect/validator/helpers.ts`。
- **`bin/repl-buffer.ts` 16 行 1 个函数** —— `isBalancedAgentBuffer` 仅被 `repl.ts` 引用，可以内联到 `repl.ts` 顶部。
- **`bin/semantic.ts` 16 行** —— 把 `loadNpmRegistry` 注入逻辑直接放在 `bin/agentscript.ts` 的 provider 工厂中，省一个文件。
- **整体上有 38 个不到 30 行的小文件**（占 27%），其中一部分确实承担了"被多处共用"的角色，但另外的 10+ 个属于过度切分。
- **`runtime/interpreter.ts:445-454` 的 `closeIfDisposable` helper** 可以内联到 `Interpreter.execute` 的 finally 块里，减少一层间接。
- **`as unknown as TraceEvent[]`** （`optimizer/provider.ts:422,427`）—— `TraceEvent.data` 字段的 `trace`、`iterations` 子结构是后续约定但 type 未表达。建议在 `TraceEvent` 里定义 `kind` → `data` 形状的 discriminated union，去掉强制类型转换。
- **Repl session 的 `console.log`/`console.error` 满文件散布**（`bin/repl-session.ts`、`bin/repl-commands.ts` 共 13 处）—— REPL 当前没有把"输出"抽成一个 `printer` 注入接口，未来要做 IDE 集成会需要扒一遍。
- **`useOneOfSiteId` 的 fallback 格式**（`runtime/interpreter.ts:432-435`）与 `language/site-id.ts:buildSiteId` 不一致，是个潜伏的 bug：当 `variantSites` map 没收集到某个站点时会返回旧格式 `"<source>:<line>:<col>"`。
- **`parseAgentSpecDraft`**（`architect/spec/schema.ts:3-5`）类型签名是 `unknown -> AgentSpecDraft | null`，但 `AgentSpecDraft = Record<string, unknown>`，等价于 "是不是普通 object"。这个名字过度承诺了"draft"语义，叫 `asPlainObject` 更准确。
- **`compileSpec`**（`architect/compiler/index.ts:16`）里的 `spec as unknown as AgentSpec` 强转，配合上一条，说明 `validateSpec` 还没有 type-narrow `AgentSpecDraft` → `AgentSpec`。可以改成 `validateSpec` 返回 `{ ok: true, spec: AgentSpec }`，去掉强转。
- **`architect/compiler/analyze.ts:30-35`** 把 SemanticDiagnostic 的 `range` 折叠成字符串 `source:<line>:<col>` 后丢失了原始 range。建议保留 range 字段（或在 `SpecDiagnostic` 上加可选的 `range`），让上层可以二次格式化。
- **`runtime/loader.ts:104-122` 的 `annotateSourcePath`** 用 WeakSet 递归遍历整棵 AST 给每个节点打 source path。这个递归本身是 OK 的，但同一份程序如果被 `loadProgramSource` 多次解析，节点是新的、WeakMap 映射也是新的——没问题，只是这条路径有点隐蔽，值得在文件顶部写一句注释。
- **`runtime/json-walk.ts` 的 `CONTINUE_JSON_WALK` / `OMIT_JSON_VALUE` 两个 Symbol** 是个小巧的设计，但 `JsonWalkPolicy` 接口的 4 个回调（`primitive` / `unsupported` / `circular` / `object`）只有 `host-marshal.ts` 完整使用，`json.ts` 的 SANITIZE_JSON_POLICY 只用了其中 3 个。可以接受。

## 5. 做得好的地方

- **`ast/types.ts` 是 single source of truth**：所有节点的形状都定义在一处，Expr / Stmt 用 discriminated union，下游所有遍历（parser、semantic walker、formatter、optimizer rewrite）都基于此。
- **`language/` 目录的存在是个好设计**：`bindings.ts` 用 `BindingKindSpec` 一张表派生出 `IMPORTED_BINDING_KINDS`、`MUTABLE_BINDING_KINDS`、`NON_CONTEXT_BINDING_KINDS`、`URI_BINDING_KINDS` 4 个集合（`language/bindings.ts:9-23`），避免了在 parser/semantic/runtime 三处各自写 4 份 enum。`memory.ts` 的 `MEMORY_METHOD_SPECS`、`tools.ts` 的 effectful 判定也是同款方法，干净利落。
- **`SchemeToolProvider` 抽象**：`providers/tools/scheme.ts:8-26` 用一个 26 行的 `SchemeToolProvider` 类给所有按 URI scheme 路由的提供商提供基础设施，`HostToolProvider` 直接继承（`providers/tools/host.ts:29`），加新 scheme 只是改一个 map。
- **`semantic/walker.ts` 的 ScopedAstVisitor 模式**：用 `enterStatement` / `enterExpression` / `afterStatement` 钩子让 analyzer 像写访问者一样组合诊断收集器，14 个 `collect*Diagnostics` 函数互不干扰。
- **`runtime/json-walk.ts` + 双策略复用**：`mapJsonLikeValue` 一个函数同时驱动 `sanitizeForJson`（`runtime/json.ts:9-10`）和 `host-marshal.ts` 的 marshal/unmarshal——两个用途都是"递归处理 JSON-like 值，但失败/绑定/循环引用的处理不同"，policy 化让两个故事保持各自清晰。
- **`generate` 流水线的状态机**：`runtime/generate.ts:60-110` 的 `runGenerateAttempt` 用 discriminated union `GenerateAttemptResult = success | retry | failure` 把每次 attempt 的三种结局表达得很清楚，retry/failure 的 trace 写入也都收敛在一处。
- **零运行时依赖的克制**：MCP stdio 客户端（`providers/tools/mcp-rpc.ts`）、SQLite memory（`providers/memory/sqlite.ts`）、JSONL memory（`providers/memory/file.ts`）都用 `node:` 内置模块手写，与项目宣称的"零依赖"一致。

## 6. 重构优先级建议

| 优先级 | 编号 | 简述 | 大致代价 |
|---|---|---|---|
| 高 | 3.2 | 把 `npm-registry` 移到 `language/`，去除 semantic→providers 的反向依赖 | 1 文件迁移 + 4 处 import 路径修改 |
| 高 | 3.4 | `interpreter.ts` 的 `executeStatement` 拆到 evaluator/或单独文件；统一 `useOneOfSiteId` 与 `buildSiteId` | 1 个大文件拆 + 1 处一致性修复 |
| 高 | 3.8 | `HostToolProvider` 改为接受外部注入的 host:// 命名空间，去掉 providers→optimizer/architect 反向 import | 1 处 API 调整 + CLI 装配代码 |
| 中 | 3.1 | `runtime/` 内部分子目录，按职责分组 32 个文件 | 文件批量移动 + 大量 import 路径调整 |
| 中 | 3.3 | 同名跨层文件（contract / generate / parallel-for）改前缀命名 | 批量重命名 + import 调整 |
| 中 | 3.5 | `optimizer/provider.ts` 拆为 inspect/trial/specialize + helper 文件 | 1 个文件拆 4–6 个 |
| 中 | 3.7 | `bin/agentscript.ts` 抽出 optimizer 子命令到独立文件 | 1 个文件拆 2 个 |
| 中 | 3.11 | `runtime/types.ts` 内部按职责分子文件，保持公开 re-export | 1 文件拆 3，改 import |
| 低 | 3.6 | 合并/重组 generate 流水线小文件 | 文件合并 |
| 低 | 3.9 | 抽出 `DiagnosticBase` 共享类型 | 增加 1 个 type |
| 低 | 3.10 | `parser/contract.ts` 改名 `labelled-block.ts`，contract 用例瘦身 | 重命名 + 小修整 |
| 低 | 3.12 | `bin/architect.ts` 用 `import.meta.url` 解析内置 .as 路径 | 1 处路径修复 |
| 低 | 第 4 节 | 合并不到 30 行的零碎文件（utils/location、anonymous、context-render、disposable、trace-event、tokens、parallel-for parser、repl-buffer、bin/semantic 等） | 文件合并，每个 1–5 分钟 |

整体建议按"高 → 中 → 低"分三轮推进。高优先级三项消除真实的反向依赖，中优先级是组织上的改进，低优先级是文件级别的整理。所有重构都应保持公开 API（`src/index.ts` re-export + `package.json` 的 `./ast/types` / `./runtime/types` / `./architect/spec/types` 三个子路径）不变，避免影响下游用户。
