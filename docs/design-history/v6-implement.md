# AgentScript V6 实施计划

本文档描述 V6 Phase 1 的实施方案。V6 设计见 `v6-design.md`。

V6 Phase 1 的实现目标是让 AgentScript 在语言生态内部完成优化闭环：
`agentscript optimizer.as ./target.as ...` 一条命令能运行一个纯 `.as` 写的
optimizer，通过 `host://agentscript` toolchain 对 target `.as` 的 `use one of`
做 inspect / trial / specialize，并把胜出候选以移动 `selected` 的形式写回
普通 `.as` 源码。这里的 target 是单入口源码工件：入口 `.as` 文件及其递归
`import agent` 依赖构成一个 target dependency graph。Phase 1 必须把这个
graph 作为 inspect / trial / specialize 的共同边界。

V6 Phase 1 不改变语言语法，不引入新的语言关键字，不引入 runtime dependency。
所有工作集中在：

- 一条新 host tool `host://agentscript`（内置 provider）；
- source-to-source 的 `selected` splicer；
- `ExecuteOptions.variant` 的 site_id 格式升级；
- CLI 的 optimizer argv 映射和进程级 budget 守护；
- 文档与示例。

## 原则

- optimizer 是一个普通 AgentScript 程序；语言核心只有 `use` 和 `generate`。
- `host://agentscript` 是内置 host tool scheme；它不是 user-registered host
  provider，也不是新语言原语。嵌入式宿主默认不授予该 tool，CLI optimizer
  模式默认授予。
- 三原语 `inspect` / `trial` / `specialize` 的对外契约（入参 schema、返回
  schema、site_id 格式、错误 code）稳定；实现层可以随 runtime / IR 变动。
- soft error 走 `{ ok: false, code, message, ... }`，hard error（IO 失败、
  budget hard cap、tool schema 违反）才抛 `RuntimeError`。
- `ExecuteOptions.variant` 统一使用 label-based site_id，与 trace / specialize
  用同一格式。
- specialize 是 token-level splicer，不做 AST→source pretty-print。
- `parallel for` 并发仍然由语言原语承担，toolchain 不引入独立编排。
- 不新增 npm dependency。

## 前置依赖

V6 依赖已有能力：

- `use one of` 语法与 semantic（已实现）。
- `ExecuteOptions.variant` 传入 hint 并在 evaluator 中覆盖选择（已实现）。
- `use` trace event 带 `variant.{site_id, picked, available, reason, empty}`
  字段（已实现）。
- host tool 机制：`host://` scheme 走 `HostToolProvider`（`src/providers/
  tools/host.ts`）；内部路由到多个 sub-provider。V6 在其中新增一个 scheme
  sub-provider。

## 阶段 0：site_id 格式迁移与 site 收集器

状态：计划中。

目标：把 runtime 现有 `variant.site_id = "<path>:<line>:<column>"` 统一到
label-based 格式 `"<path>#<agent>.<func>[<label>]"`，并提供 inspect / trial /
specialize / runtime 共用的 site 收集器，作为 V6 其余阶段的共用前置。

修改：

```text
src/runtime/interpreter.ts              // declareUseOneOf 使用静态 site metadata
src/runtime/loader.ts                   // 保留 import agent 节点的 origin source file
src/runtime/use-one-of.ts               // 共享 variant 选择逻辑
src/language/site-id.ts                 // site_id builder + path 规范化
src/language/source-map.ts              // AST node origin source metadata
src/language/variant-sites.ts           // AST walker：收集 use-one-of site metadata
src/toolchain/agentscript.ts            // provider 层 JSON 化包装
```

实现要点：

- 新增 `src/language/site-id.ts`，导出：
  ```ts
  export interface SiteIdContext {
    sourcePath: string | undefined;   // 来自 ExecuteOptions.sourcePath
    workspaceRoot: string | undefined;
    agentName: string;
    funcName: string | undefined;     // agent-level use one of 时为 undefined
    label: string;
    ordinal: number;                  // 1 表示第 1 次出现，>=2 追加 #N
  }
  export function buildSiteId(ctx: SiteIdContext): string;
  export function normalizeTargetPath(
    path: string | undefined,
    workspaceRoot: string | undefined,
  ): string;
  ```
- loader 必须为 merged program 中来自 `import agent` 的 AST 节点保留 origin
  source file。推荐使用 side table（例如
  `WeakMap<AstNode, { sourcePath: string }>`）或 loader 返回的 source map，
  不把文件来源写进 AST node 的 public shape。runtime trace、inspect、
  trial selection validation、specialize 都必须读取同一份 origin metadata。
- 新增 `collectVariantSites(program, ctx)`，返回：
  ```ts
  interface CollectedVariantSite {
      node: UseOneOfStmt;
      siteId: string;
      label: string;
      scope: { kind: "agent" | "function"; agent: string; func?: string };
      ordinal: number;
      selected: string | null;
      defaultReason: "selected" | "first";
      candidates: Array<{
          node: UseOneOfCandidate;
          name: string;
          empty: boolean;
          budget?: Budget;
      }>;
  }
  ```
- path 规范化规则与 v6-design 一致：
  - `sourcePath` 未提供时 path 段输出 `<memory>` 字面量（与现状一致），主要
    用于 REPL / 内存嵌入场景。
  - `sourcePath` 已提供且 `workspaceRoot` 已提供时，相对于 `workspaceRoot`
    输出 POSIX 路径。
  - `sourcePath` 已提供但 `workspaceRoot` 未提供时，CLI 场景相对于 cwd 输出
    POSIX 路径；嵌入式场景若没有稳定 cwd 约定，可退化为绝对 POSIX 路径。
- label 序号：
  - agent-level 与 function-level 分别独立计数；收集器按源码遍历顺序对
    `(source file + agent 名 + func 名 + label)` 建立局部计数器。
  - 不把 ordinal 写回 AST。运行期 interpreter 在构造时生成
    `WeakMap<UseOneOfStmt, CollectedVariantSite>`，`declareUseOneOf` 只读 side
    table。这样 AST 保持语法树语义，不被 semantic / runtime 派生信息污染。
- `ExecuteOptions.variant` 的 key 匹配逻辑：runtime 构建 site_id 后查 map，
  未命中时尝试"兼容旧 `<path>:<line>:<column>` 格式"吗？**不兼容**。V6
  是 cold-start 切换，旧格式直接失配。老测试同步改名（见阶段 8）。

验收：

- 新 `variant.site_id` 在所有现有 `use one of` 测试中生成期望格式。
- `ExecuteOptions.variant` 新 key 命中时 reason = `"trial"`，旧 key 不被
  特殊处理。
- 构建 site_id 的逻辑被 `inspect` / `trial` / `specialize` 共享，避免重复实现。
- 重复 label 位于未执行分支时，runtime 仍生成与 inspect 一致的 site_id
  ordinal；不能用动态执行计数替代静态收集。
- imported agent 中的 `use one of` 在 runtime trace 里使用 imported 文件的
  normalized path，而不是入口 target 文件路径。

## 阶段 1：variant site metadata 与 semantic 集成

状态：计划中。

目标：让 `inspect`、`trial`、`specialize` 和 runtime 能拿到每个
`UseOneOfStmt` 的 scope 元数据与 label 序号，且不引入新的语言语义。

修改：

```text
src/language/variant-sites.ts // 新增：program 级 use-one-of site 收集
src/semantic/analyzer.ts      // 如需复用 traversal helper，暴露必要上下文
src/semantic/use.ts           // 继续沿用已有诊断；不读取 ordinal
```

实现要点：

- `variant-sites.ts` 是纯收集器：输入 AST + path context，输出 site metadata。
  它不产生诊断、不修改 AST，也不替代 semantic analyzer。
- agent-level `use one of` 的 `func` 段为 `undefined`；site_id builder 遇到
  undefined 时输出 `<path>#<agent>[<label>]`。
- 若 analyzer 发现同一 `(agent, func, label)` 组合出现 `N` 次，从第 2 次起
  `ordinal = 2, 3, ...`；第 1 次 `ordinal = 1`，site_id 不追加后缀。
- 这个编号是 metadata，不改动 AST node kind，不影响 trace event 的
  `available` / `picked` 等字段。

验收：

- 收集器跑完后每个 `UseOneOfStmt` 能被询问 `{agent, func?, label, ordinal}`。
- 重复 label 的目标文件下 site_id 稳定区分。
- 现有 semantic 诊断（`DUPLICATE_USE_ONE_OF_CANDIDATE`、`RESERVED_CONTEXT_LABEL`
  等）不变。

## 阶段 2：`host://agentscript` scheme sub-provider

状态：计划中。

目标：在现有 `HostToolProvider` 里注册 `agentscript` scheme，三个方法
`inspect` / `trial` / `specialize` 路由到新模块。

新增模块：

```text
src/toolchain/agentscript.ts                  // AgentscriptToolProvider + 三原语实现
src/providers/tools/host.ts                   // host://agentscript 薄路由
```

修改：

```text
src/language/schemes.ts                 // 新增 AGENTSCRIPT_SCHEME = "agentscript"
src/providers/tools/host.ts             // 将 AgentscriptToolProvider 注册进去
src/semantic/walker.ts / analyzer.ts    // parallel-for 内 effectful 列表包含
                                        // `agentscript`（见阶段 6）
```

实现要点：

- `AgentscriptToolProvider implements ToolProvider`：
  ```ts
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
      switch (request.method) {
          case "inspect":    return inspect(request);
          case "trial":      return trial(request, this.ctx);
          case "specialize": return specialize(request, this.ctx);
          default: throw new RuntimeError(
              `Unknown AgentScript method '${request.method}'`,
          );
      }
  }
  ```
- `ctx` 内含：runtime options（workspaceRoot、sourcePath base）、budget 计数
  器句柄、artifacts 目录句柄、外层 trace 的写入能力。由 interpreter 在
  构造 `HostToolProvider` 时注入（见阶段 7）。
- `host://agentscript` URI 不允许带 path 段；`host://agentscript/foo` 统一
  返回 `{ ok: false, code: "invalid_uri", message }`。
- 每个方法的入参类型用 TypeScript interface 声明并做 runtime 校验；任何
  tool schema 违反（非 object、字段缺失、类型错误）抛 `RuntimeError`
  （hard error）。

验收：

- `.as` 中 `AgentScript.inspect({ target: "..." })` 调用成功到达 `inspect.ts`。
- `AgentScript.unknown_method(...)` 返回 hard error 消息带 method 名与 URI。

## 阶段 3：inspect 实现

状态：计划中。

目标：纯静态分析，不执行 target；覆盖入口 target 及其递归 `import agent`
依赖组成的 target dependency graph。

新增 / 修改：

```text
src/toolchain/agentscript.ts
```

实现要点：

- 新增或扩展 loader API，返回 target source graph：
  ```ts
  interface TargetSourceFile {
      absPath: string;
      normalizedPath: string;  // site_id path 段使用的路径
      source: string;
      ast: Program;
  }

  interface TargetSourceGraph {
      entry: TargetSourceFile;
      files: TargetSourceFile[];       // 包含 entry 与递归 import agent 依赖
      mergedProgram: Program;          // 现有 loadProgram 语义，用于 semantic / trial
      snapshotId: string;
  }
  ```
- source graph loader 必须复用现有 `import agent` 解析规则，避免 optimizer
  toolchain 另造一套 module resolution。循环导入、缺失文件等错误按现有
  loader 语义报告。
- semantic 分析使用 `TargetSourceGraph.mergedProgram` 调用
  `analyze(program, { npmRegistry? })`；若有 error 诊断，
  返回：
  ```json
  {
    "ok": false,
    "code": "semantic_error",
    "target": "<normalized-path>",
    "diagnostics": [ { ... } ]
  }
  ```
- 成功路径：
  - 计算 `snapshot_id`：对 graph 中每个 `.as` 文件读取原字节、做 UTF-8
    NFC 归一（用 Node `String.prototype.normalize("NFC")`）、去 BOM、行尾
    归一；再把 `normalizedPath + "\0" + normalizedSource` 串联后取
    SHA-256 hex，前缀 `sha256:`。文件顺序按 `normalizedPath` 排序。
  - 从每个 `TargetSourceFile.ast` 抽取所有 `UseOneOfStmt`，按
    `(normalizedPath, source order)` 构造 graph 级
    `variant_sites`：
    ```ts
    interface VariantSite {
        site_id: string;
        label: string;
        scope: { kind: "agent" | "function"; agent: string; func?: string };
        selected: string | null;       // 源码 selected 的候选名；无则 null
        default_reason: "selected" | "first";
        candidates: VariantCandidate[];
    }
    interface VariantCandidate {
        name: string;
        empty: boolean;
        budget: { amount: number; unit?: string } | null;
    }
    ```
  - `baseline_selection`：遍历 `variant_sites`，每个 site 取 `selected ??
    candidates[0].name`。
  - `files`：返回 graph 中所有 `.as` 文件的 `normalizedPath`，顺序与
    `snapshot_id` 计算一致。
  - `warnings` 数组：
    - 若 `variant_sites` 为空：追加 `{code: "no_variant_sites"}`。
    - 若 target 中出现 effectful tool 的 import 且未列入 `allowTargetTools`：
      追加 `{code: "target_effectful_tool", tool, uri}`。effectful scheme 集合
      与 semantic 阶段共享常量（见阶段 6）。
- path 规范化与 site_id 构建全部走阶段 0 的 builder。site_id 的 path 段
  必须指向 site 所在文件，而不是入口 target 文件。
- semantic 校验采用 `assertSemanticallyValid` 的宽松版（不抛，而是返回
  diagnostics）——若现有 API 是 `analyze` + `assertSemanticallyValid` 两件，
  使用 `analyze`，自行过滤 severity。
- 结果 JSON 化：inspect 返回的整个 object 必须 JSON-safe。借用现有
  `sanitizeForJson`（位于 `src/runtime/json.ts`）确保返回值可直接通过
  marshal。

hard error 条件（抛 `RuntimeError`）：

- `target` 参数缺失、非 string、文件 IO 失败。
- 入参 schema 违反。

soft error 条件（返回 `{ok: false, code, ...}`）：

- `semantic_error`。

验收：

- `inspect({target: "tests/fixtures/target-single.as"})` 返回正确形状。
- 带 `import agent` 的 target 返回 graph 内所有 `.as` 文件的
  `variant_sites` 与 `files`，并且 site_id path 指向定义 site 的文件。
- 不存在的文件以 hard error 抛出（而非 soft error），错误消息带路径。
- 只含普通 `use` 的 target 返回 `ok: true, variant_sites: [], warnings:
  [{code: "no_variant_sites"}]`。
- `import tool Search from "mcp://..."` 的 target 触发
  `target_effectful_tool` warning，除非 allow list 包含它。

## 阶段 4：trial 实现

状态：计划中。

目标：对 target 跑一次带 variant map 的 `executeAgent`，把 trace 按
`trace` 参数分档输出。

新增 / 修改：

```text
src/toolchain/agentscript.ts
src/runtime/interpreter.ts          // 若需暴露一个纯 executeAgent-with-provider
                                    // variant 的内部 API
```

实现要点：

- 入参：
  ```ts
  interface TrialArgs {
      target: string;
      entry?: { agent: string; func?: string };
      input: JsonValue;
      selection?: Record<string, string>;
      snapshot_id?: string;
      trace?: "summary" | "full" | "none";
      run_id?: string;
  }
  ```
- 默认 `trace = "summary"`；合法值之外抛 hard error。
- snapshot 校验：
  - 若入参提供 `snapshot_id`：重新读取 target dependency graph 并计算 hash；
    不等则：
    - `trace_result.warnings.push({code: "snapshot_mismatch", expected, actual})`。
    - 继续执行。
- 加载 target：调用 source graph loader，取其中的 `mergedProgram` 再
  `analyze` 一次（inspect 和 trial 是独立调用，不共享 cache；Phase 1 允许
  这点冗余，以后可以加 per-snapshot 内存缓存）。
- entry resolution：
  - 缺省时走现有 `resolveEntryAgent` + `resolveMainFunction`。
  - 指定 `entry.agent` 时用 `requireAgent(agent, ...)`。
  - `entry.func` 存在时用 `findFunction(agent, entry.func)`；不存在时仍调用
    `resolveMainFunction(agent)`，不能假设主函数名一定是 `"main"`。
  - 找不到 entry agent / function 时返回 soft error
    `{ ok: false, code: "unknown_entry", ... }`。这是 optimizer 参数错误，但
    仍应让 optimizer.as 能把它写进 report。
- selection 验证：
  - 展开 target dependency graph 内的所有 `(site_id, variant)`（复用 inspect
    的抽取逻辑），包括递归 `import agent` 引入文件里的 site_id。
  - 每个 selection entry：site_id 不在表中返回 soft error
    `unknown_selection_key`；variant 名不在候选列表返回 `unknown_variant`。
  - 全部合法后传给 `executeAgent` 的 `ExecuteOptions.variant`。
- target LLM / tool / memory provider：复用 outer interpreter 的 provider。
  具体做法——trial 创建一个**新的** `executeAgent` 调用，使用 outer 的
  `llmProvider` / `toolProvider` / `memoryProvider` 作为默认。这样 target
  内 `openai://` / `npm:` / `host://search` 等仍然 live。
  - 如果 outer 的 `toolProvider` 是 V6 加入 `host://agentscript` 的版本，那
    target 里也能看到 `host://agentscript`。Phase 1 这是允许的（对应"递归
    自优化"场景，文档不推荐但不堵死）。
  - trial 不提供 `llm_override`（v6-design 已决定字段不暴露）。
- 运行前配额检查：
  - `budget.incrementTrial()`：若 trial 总数已超 `--max-trials`，抛
    `RuntimeError("BUDGET_EXCEEDED: trials")`（hard error）。
  - 为当次 trial 注入一个 llm-count 装饰：包装 outer `llmProvider`，每次
    generate 前调 `budget.incrementLlm()`；超限抛同样的 hard error。
- 采集 inner trace：`executeAgent` 返回 `{ value, trace }`。把 trace 按
  `trace` 参数决定去向：
  - `summary`：写入 `<runDir>/trials/<trial-id>.jsonl`；返回值 `trace = null,
    trace_ref = "<relative path>"`。
  - `full`：写入磁盘 + inline 到返回值。
  - `none`：不写不 inline，`trace_ref = null`。
- 采集 usage：在 outer `llmProvider` 装饰中汇总 `llm_calls` 等字段；latency
  通过 `performance.now()` 两点差值。
- `picked` 和 `unreached_selection`：
  - 扫描 inner trace 中所有 `use` event 的 `variant` 字段，填入 `picked[
    site_id] = {variant, reason, empty}`。
  - `unreached_selection`：从入参 `selection` 的 key 集合中减去 trace 实际
    出现的 site_id 集合，剩余为 unreached。
- trial-id：`${run_id ?? "run"}-${Date.now()}-${counter++}`，保证同一 run
  内 trial artifacts 文件名唯一。

错误模型：

- hard error（throw RuntimeError）：
  - 入参 schema 违反；
  - `BUDGET_EXCEEDED`；
  - 文件 IO 失败。
- soft error（返回 `{ok: false, ...}`）：
  - `semantic_error`（trial 前再次 analyze，失败时）；
  - `unknown_entry`；
  - `unknown_selection_key` / `unknown_variant`；
  - target 运行时抛 RuntimeError（例如 target 自身 bug）时，trial 把它转成
    soft error `{ ok: false, code: "target_runtime_error", message, trace,
    trace_ref }`。**关键**：target 抛错不让整个 optimizer 崩溃——optimizer
    要能把 trial failure 写进 report。
- warnings：snapshot_mismatch（见上）。

验收：

- trial 成功路径返回正确的 usage / picked / trace_ref；mock LLM 下 token
  字段可以为 0 或 null，但 `llm_calls` 必须正确计数。
- 不同 trace 等级行为符合 schema。
- selection key / variant 拼写错误返回对应 soft error code。
- target 运行期 RuntimeError 被捕获转成 soft error。
- `import agent` 引入的 sub-agent site 可以被 selection 命中，并出现在
  `picked` / `unreached_selection` 里。
- budget 超限产生 hard error。

## 阶段 5：specialize 实现

状态：计划中。

目标：token-level 的源码改写，只动候选尾部 `selected`（structure-preserving）
或崩塌为普通 `use`（flatten）。

新增模块：

```text
src/toolchain/agentscript.ts              // Phase 1 可先单文件实现，后续再拆模块
src/toolchain/source-rewrite.ts           // 纯源码文本操作（可选拆分）
```

### 5.1 structure-preserving 模式

算法（基于现有 AST `range`）：

1. 读取 target dependency graph，得到每个 `TargetSourceFile` 的源码与 AST。
2. 按文件遍历每个 `UseOneOfStmt`，为每个 candidate 记录：
   - `nameToken`：候选名 token 的 range（用于定位"candidate 行"）。
   - `valueRange`：候选值表达式的 range（`empty` 时是 `empty` 关键字的 range）。
   - `budgetEnd`：若有 `max budget`，budget 数字 token 的 end；否则等于
     valueRange.end。
   - `selectedToken`：若带 `selected`，记录该 token 的 range（包括前导空白
     的区段，用于精确删除）。
3. 对每个 selection 指定的 site，先按 site_id 定位到所属文件，再定位
   `UseOneOfStmt`：
   - 找当前带 `selected` 的候选 A（可能没有）。
   - 找目标候选 B（selection 指定的 variant）。
   - 若 A == B：no-op，edit.record changed: false。
   - 否则：
     - 从 A 的候选尾部删除 ` selected`（精确删除 "whitespace + selected"
       的一段）。
     - 在 B 的 `budgetEnd`（或 value 末尾）后插入 ` selected`。
4. `comment` 参数：若非空，按约定在 B 候选的**前一行**插入
   `// <comment>`；缩进与候选名 token 所在行的前导空白对齐。
5. 按文件对 edits 分组；每个文件内按 offset 从大到小排序，再串行 splice
   source（倒序可避免位移影响后面的 offset）。
6. 生成 unified diff（用 `node:diff` 不可用——不新增依赖。手写一个最简 diff
   或借用 `src/utils/` 的既有能力；否则只返回 "从 A→B" 的 edit 列表，diff
   作为 optional 字段留给 Phase 2）。
   - **Phase 1 决策**：只计算 edit 列表；diff 字段输出简化 "unified-ish"
     形式（自己拼 `--- old / +++ new / @@` 段落，只涵盖每个被改写
     `UseOneOfStmt` 的整段 block），不追求与 `git diff` 逐字一致。

### 5.2 flatten 模式

算法：

1. 定位 selection 指定 site 的胜出候选 B。
2. 找到整个 `UseOneOfStmt` 的 source range。
3. 若 B 是 `empty`：把整个 `UseOneOfStmt` 从源码删除，保留前后空行策略
   （删除语句所在行的换行，以免留下空白行）。
4. 若 B 非 `empty`：把整个 `UseOneOfStmt` 替换为
   `use <expr> [max <budget>] as <label>`。expr / budget / label 直接取自
   B 的 source slice，不做 pretty-print。
5. `comment`：若非空，按约定在替换行**上方**插入 `// <comment>`。

### 5.3 共用行为

- `fill_missing: "source_default"` 与 `"require"` 的校验：
  - `source_default`：未覆盖 site 不做修改。
  - `require`：selection 缺少 target dependency graph 内任何 site 返回 soft
    error `incomplete_selection` + `missing_sites`。若 optimizer 只想对过滤后
    的 agent 范围严格，应在策略层先验证过滤范围，再用 `source_default`
    写回。
- `write` 分支：
  - `preview`：不落盘，返回 `{ok: true, changed, diff, edits, output: null}`。
  - `copy`：单文件 graph 默认 `<target>.optimized.as`；多文件 graph 默认
    `<target-stem>.optimized/` 输出目录。若 `output` 给定，单文件时它是输出
    文件，多文件时它必须是目录。多文件 copy 至少写出 graph 内所有 `.as`
    文件，并按 graph 相对路径保持 `import agent` 关系；未变更文件可以直接
    复制原文。若输出内容 hash 与已有文件一致，不重写该文件。
  - `in_place`：按文件覆盖 selection 涉及的原 `.as` 文件；未变更文件不写。
- `snapshot_id`：写入前重新读取整个 target dependency graph 并计算 hash；
  与入参不一致返回 `snapshot_mismatch`。
- selection 未知 key / variant：返回对应 soft error（与 trial 一致）。
- 返回值必须 JSON-safe；`edits[]` 的每条都带 site_id / file / label / from /
  to。`output` 返回主输出位置；`outputs[]` 返回本次 preview 或写入涉及的
  所有文件。

错误模型：

- hard error：入参 schema 违反、文件 IO 失败。
- soft error：`semantic_error`、`snapshot_mismatch`、`incomplete_selection`、
  `unknown_selection_key`、`unknown_variant`。

验收：

- 从"selected 在 A"→"selected 应在 B"的简单 case，生成的文件 diff 只包含
  两行变化（A 删除 selected、B 新增 selected）。
- 多 site 多变动一次 run 正确，不出现 offset 错位。
- 多文件 graph 下，selection 命中不同文件时能按文件分别改写；preview diff
  能标明每个文件。
- `comment` 在 B 上方一行注释，与 B 同缩进。
- flatten 模式对 `empty` 胜出正确删除整段 `UseOneOfStmt`。
- write: "preview" 不落盘。
- write: "copy" 不覆盖原文件；多文件 target 输出目录保留 `import agent`
  graph。
- write: "in_place" 覆盖涉及 selection 的原文件。
- 未知 selection key 不写文件。

## 阶段 6：Semantic 与 effectful tool scheme 列表

状态：计划中。

目标：集中定义 effectful tool scheme / method，供 parallel-for semantic
检查与 inspect warning 复用；同时保持 `AgentScript.trial` 可在
`parallel for` 中并发调用。

修改：

```text
src/semantic/parallel-for.ts       // parallel-for body 的 effectful call 规则
src/language/tools.ts              // 抽出 method-aware tool effect 判断
src/language/schemes.ts            // AGENTSCRIPT_SCHEME 常量
```

实现要点：

- 若 semantic 层已经维护过 effectful scheme 列表（例如 V3/V4/V5 中已存在），
  不要简单地把 `agentscript` 整个 scheme 加入"parallel 中禁止"集合。V6 的
  设计目标正是让 optimizer 用 `parallel for` 并发 trial，因此
  `AgentScript.trial(...)` 必须允许出现在 parallel body 中。
- 抽出两组判断：
  ```ts
  export const AGENTSCRIPT_SCHEME = "agentscript";
  export const PARALLEL_FORBIDDEN_TOOL_SCHEMES = new Set([
      MCP_SCHEME, SHELL_SCHEME, HTTP_SCHEME, HTTPS_SCHEME,
      NPM_SCHEME, NODE_SCHEME, ENV_SCHEME, FILE_SCHEME,
  ]);
  export function isParallelForbiddenToolCall(method: string, uri?: string): boolean;
  export function isTargetEffectfulToolImport(uri: string): boolean;
  ```
- `isParallelForbiddenToolCall` 对 `host://agentscript` 做 method-aware 判断：
  - `inspect`：允许。只读 target 源码。
  - `trial`：允许。它会写 artifacts / 消耗 budget，但这是 V6 显式支持的并发
    trial 路径；BudgetCounter 和 artifacts writer 必须保证并发安全。
  - `specialize`：禁止在 `parallel for` body 中直接调用。它写源码工件，应由
    optimizer 在选择 winner 后串行执行。
- `isTargetEffectfulToolImport` 用于 inspect warning。它可以把 `host://`（除
  agentscript 自身）、`npm:`、`node:`、`mcp:`、`sh:` 等视为 effectful，
  与 parallel 禁止集合不必完全相同。

验收：

- `parallel for` body 中 `AgentScript.trial(...)` 允许通过 semantic check。
- `parallel for` body 中 `AgentScript.specialize(...)` 被 semantic check 拒绝。
- `parallel for` body 中现有 npm / node / mcp 等 effectful tool call 仍被拒绝。
- 现有 effectful tool 场景行为不变。

## 阶段 7：Interpreter 接入 budget / artifacts / variant key 校验

状态：计划中。

目标：让 `host://agentscript` provider 能拿到 outer runtime 的 provider、
budget counter 和 artifacts 目录句柄。

新增 / 修改：

```text
src/runtime/interpreter.ts              // ExecuteOptions 新增 budget / artifacts
                                        // 向 tool provider 注入上下文
src/runtime/types.ts                    // 类型导出
src/providers/tools/host.ts             // HostToolProvider 构造支持 ctx
src/toolchain/agentscript.ts            // 接收 ctx
```

实现要点：

- `ExecuteOptions` 增加字段（CLI 场景由 optimizer driver 注入）：
  ```ts
  interface ExecuteOptions {
      ...
      budget?: BudgetCounter;
      artifactsDir?: string;
  }

  interface BudgetCounter {
      incrementTrial(): void;     // 超限抛 RuntimeError("BUDGET_EXCEEDED: ...")
      incrementLlm(delta?: number): void;
      elapsedSeconds(): number;
      checkDeadline(): void;       // 超时则抛 BUDGET_EXCEEDED: seconds
  }
  ```
- `BudgetCounter` 的默认实现无上限（Phase 1 由 CLI 层在启动 optimizer 时
  创建带上限的实例）。
- `artifactsDir` 决定 trial trace JSONL 的落盘位置；CLI 默认
  `.agentscript/optimizations/<timestamp>/`，由 CLI 创建。provider 不做目录
  创建（由 artifacts.ts 懒创建子目录）。
- `ExecuteOptions.variant` 的 key 类型保持 `string`。interpreter 本身不做全量
  key 预校验，只在某个 site 实际执行到时按 site_id 查 map；未知 key 的严格
  校验由 trial 层在执行前完成（阶段 4）。这样嵌入式 user 仍可直接使用
  `executeAgent` 的最小 runtime API，而 optimizer toolchain 获得更严格的
  trial 语义。

验收：

- CLI 注入 budget 后，超限抛 hard error 能被 CLI 层捕获。
- artifactsDir 为空时，trial 退化为返回 `trace_ref: null` 且不落盘（等同于
  `trace: "none"` 的语义；这是嵌入式使用时的合理默认）。

## 阶段 8：CLI 改造

状态：计划中。

目标：支持 `agentscript optimizer.as [<target>] [--<key> <value> ...]` 语义；
支持 V6 运行时硬上限 flags；沿用现有 `agentscript file.as ...` 模式不变。

修改：

```text
src/bin/args.ts                // 扩展 CliOptions；识别新 flag
src/bin/agentscript.ts         // 分辨"普通运行 vs. optimizer 运行"模式
src/bin/optimizer.ts           // 新：optimizer 模式的 runner
```

实现要点：

- 新的判别规则：
  - 位置参数分两种：
    - 常规模式：1 个位置参数 = `<file.as>`；
    - optimizer 模式：2 个位置参数 = `<optimizer.as> <target.as>`。
  - 仅当出现第 2 个位置参数（且是 `.as`）时进入 optimizer 模式。
  - 可选的显式开关 `--optimizer`：强制以 optimizer 模式运行 `file.as`。
- optimizer 模式下：
  - 第 1 个位置参数作为 `optimizer.as` 加载；
  - 第 2 个位置参数自动映射到 `input.target`；
  - 其它 `--key value` 对按阶段 8.1 的规则进入 `input`。
  - 运行时硬上限 flag 不进入 `input`，仅作为 BudgetCounter / artifactsDir
    初始化参数。
- 互斥与兼容：
  - optimizer 模式下仍允许 `--trace` / `--trace-file` 等调试 flag（针对
    optimizer 自己的 outer trace）。
  - `--mock` 与 optimizer 语义正交：optimizer 自己走 mock LLM，target 也走
    mock LLM。

### 8.1 argv 映射

- flag 规则：
  - `--key value` → `input.key = value`（按 contract 类型转换）。
  - `--key=value` → 同上。
  - `--flag` → `input.flag = true`；`--no-flag` → `input.flag = false`。
  - `-` → `_`：`--dry-run` 映射 `input.dry_run`。
  - optimizer contract 未覆盖的字段按 `string` 处理；这样用户声明 `run_id:
    string` 也能自然接收。
- 保留 flag（不映射到 input）：
  ```text
  --max-trials <N>
  --max-llm-calls <N>
  --max-seconds <N>
  --allow-target-tool <x>   可重复；可逗号分隔
  --run-dir <DIR>
  --trace-level summary|full|none
  --optimizer
  --trace / --trace-file / --quiet / --verbose / --check / --parse
  ```
  这些保留 flag 出现时优先解释为 runtime flag，不进入 `input`。
- 位置参数只允许 2 个（optimizer.as + target.as）；更多报错
  `Unexpected positional argument`。

### 8.2 optimizer runner

`src/bin/optimizer.ts` 大致流程：

```ts
export async function runOptimizer(opts: OptimizerCliOptions): Promise<number> {
    const program = loadProgram(opts.optimizerFile);
    assertCliProgramSemanticallyValid(program);

    const runDir = opts.runDir ?? defaultRunDir();
    mkdirp(runDir);

    const budget = createBudgetCounter({
        maxTrials:   opts.maxTrials   ?? 1000,
        maxLlmCalls: opts.maxLlmCalls ?? 10000,
        maxSeconds:  opts.maxSeconds  ?? 1800,
    });

    const input = assembleOptimizerInput(opts);  // flag→input mapping
    const llmProvider = createCliLlmProvider(opts);     // 复用现有逻辑
    const inputProvider = terminalInputProvider();

    try {
        const result = await executeAgent(program, input, {
            agentName:    opts.agentName,
            concurrency:  opts.concurrency,
            functionName: opts.functionName,
            inputProvider,
            llmProvider,
            sourcePath:   opts.optimizerFile,
            artifactsDir: runDir,
            budget,
            toolProvider: createCliToolProvider({
                workspaceRoot: process.cwd(),
                agentscript: {
                    artifactsDir: runDir,
                    budget,
                    allowTargetTools: opts.allowTargetTools,
                },
            }),
        });
        writeOptimizerOutcome(result, opts, runDir);
        return 0;
    } catch (error) {
        return reportOptimizerError(error, runDir);
    } finally {
        inputProvider?.close?.();
    }
}
```

- `writeOptimizerOutcome`：
  - 把 `result.value` 写到 stdout（JSON），或按 `--quiet` 只打 value。
  - 若 `result.value.changed === false`：打印 "Nothing to optimize" 并 exit 0。
- `reportOptimizerError`：
  - `BUDGET_EXCEEDED` → 打印原因 + runDir 路径 → exit 2。
  - 其它 RuntimeError → exit 1。

验收：

- `agentscript optimizer.as ./target.as --evalset eval.jsonl --output out.as
  --dry-run` 能启动；不 target.as 被实际写入。
- `--max-trials 5` 超限时进程以 `BUDGET_EXCEEDED: trials` 退出非零。
- `agentscript optimizer.as ./target.as --max-trials 0` 表示无上限。
- `agentscript optimizer.as` 少第 2 个位置参数时不强制报错——此时依赖
  optimizer 自己的 contract 校验判断是否必须；这是 V6 设计中的"把 input 校验
  交给 optimizer contract"的自然结果。

## 阶段 9：测试计划

状态：计划中。

所有测试走 mock LLM，避免网络 / 付费 LLM。test fixtures 的 `.as` 必须能通过
现有 semantic 分析。

新增测试文件：

```text
tests/host-agentscript.inspect.test.ts
tests/host-agentscript.trial.test.ts
tests/host-agentscript.specialize.test.ts
tests/host-agentscript.site-id.test.ts
tests/cli.optimizer.test.ts
tests/fixtures/v6/target-single.as
tests/fixtures/v6/target-multi-agent.as
tests/fixtures/v6/target-agent-level.as
tests/fixtures/v6/target-effectful.as
tests/fixtures/v6/optimizer-minimal.as
tests/fixtures/v6/evalset.jsonl
```

覆盖点：

- inspect：
  - 单 agent + 单 function + 多 use-one-of：variant_sites 正确。
  - agent-level use-one-of：scope.kind == "agent", site_id 缺省 func 段。
  - 同 label 多次出现：ordinal 递增。
  - 空文件（无 use-one-of）：`no_variant_sites` warning。
  - semantic 错误：返回 `ok: false, code: "semantic_error"`。
  - effectful tool 警告。
- trial：
  - 成功路径：picked 数据正确；usage 字段存在，`llm_calls` 计数正确。
  - selection 拼写错误（未知 key / variant）→ soft error。
  - 部分 selection → 未覆盖 site 走 source default，reason 为 `"selected"`
    或 `"first"`。
  - trace summary / full / none 三档行为。
  - snapshot mismatch → warnings 有对应条目；结果仍 ok。
  - budget 超限 → hard error。
  - target 运行时错误 → soft error，不影响 optimizer 继续。
  - multi-agent target 中 selection 命中 sub-agent 的 site。
- specialize：
  - 基础 structure-preserving：single selected move。
  - comment 插入正确。
  - empty 胜出 flatten 整段删除。
  - non-empty 胜出 flatten 替换为普通 use。
  - preview 不落盘；copy 不覆盖原文件；in_place 覆盖。
  - snapshot mismatch → soft error。
  - require + 缺失 site → soft error。
  - 未知 site / variant → soft error，不写文件。
  - 变动为 no-op（目标 variant 已是当前 selected）时 `changed: false`，
    `edits: []`，不写文件。
- site-id：
  - label-based 构造规则全覆盖，包括 multi-agent、agent-level、重复 label。
  - path 规范化：cwd 相对 / workspaceRoot 相对 / 绝对路径。
- CLI：
  - `agentscript optimizer.as ./target.as` argv 映射正确。
  - `--dry-run` → `input.dry_run == true`。
  - `--max-trials 1 --max-llm-calls 1 --max-seconds 1` 触发 BUDGET_EXCEEDED。
  - multi-positional 报错。
  - `agentscript file.as` 普通模式回归。

## 阶段 10：文档与示例

状态：计划中。

文档：

- `docs/cn/optimizer.md` / `docs/en/optimizer.md`：新增一页，面向用户的
  optimizer 快速教程 + toolchain API 速查。
- `docs/cn/language.md` / `docs/en/language.md`：在 host tool URI scheme
  列表中增加 `host://agentscript` 条目，链接到 optimizer 文档。
- README：在 feature list 追加一条"自带 optimizer toolchain"。
- CHANGELOG：V6 条目。

示例：

```text
examples/optimizer/                 // 完整示例工程
  README.md
  triage.as                         // 目标 agent，带两条 use one of
  fixtures.json                     // evalset
  optimizer.as                      // 最小 optimizer (约 80 行)
  stdlib/
    grid.as
    stats.as
    selection.as
    report.as
  optimized-target.expected.as      // 用于 CI 回归验证
```

`optimizer.as` 最小示例使用 `--mock` 可跑通；带真实 LLM 的路径在 README 说明。

验收：

- `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build`
  全部通过。
- `node dist/bin/agentscript.js examples/optimizer/optimizer.as
  examples/optimizer/triage.as --evalset examples/optimizer/fixtures.json
  --output .agentscript/triage.out.as --dry-run --mock` 能跑到结束并打印
  `changed: false` / `Nothing to optimize` 之类合理输出（mock 下 judge 无
  差异）。

## 实施顺序建议

推荐顺序：

1. **阶段 0**：site_id 迁移与 site 收集器。必须先行，后续一切阶段共享。
2. **阶段 1**：variant site metadata 与 semantic 集成，让 inspect / runtime
   都能通过 side table 取得 scope 与 ordinal。
3. **阶段 2**：host scheme provider 骨架（空方法也要能跑通），确立对外入口。
4. **阶段 3**：inspect。
5. **阶段 5**：specialize（独立于 trial，纯源码操作，先做能解耦风险）。
6. **阶段 7**：ExecuteOptions 接入 budget / artifacts，为 trial 准备运行上下文。
7. **阶段 4**：trial（依赖 inspect 的 site 抽取逻辑，以及阶段 7 的 budget /
   artifacts）。
8. **阶段 6**：semantic 的 effectful scheme 更新。
9. **阶段 8**：CLI。
10. **阶段 9**：测试补齐。
11. **阶段 10**：文档与示例。

实务上阶段 3、4、5 可以交叉推进：三个原语都依赖相同的 site 抽取逻辑，抽
一个 `collect_variant_sites(program)` 放在 `agentscript/` 子目录共享。

## 风险与取舍

### site_id 破坏性变更

风险：已有依赖 `<path>:<line>:<column>` 格式的用户（文档 / blog / 测试）
一次全失效。

Phase 1 处理：

- 冷启动阶段允许破坏性切换；一次性改名。
- `use one of` 设计文档 / 示例 / 测试同步更新。
- changelog 标出 breaking change。

### snapshot hash 稳定性

风险：不同平台 line-ending / UTF-8 BOM 导致 hash 漂移，optimizer 认为"文件
变了"。

Phase 1 处理：

- hash 前做 UTF-8 NFC 归一 + 行尾归一（`\r\n` → `\n`），BOM 去除。
- `inspect` 与 `specialize` 共用同一 hash 函数。
- 测试覆盖三种场景：纯 LF、CRLF、BOM 前缀。

### specialize 的 comment 插入破坏格式

风险：自动插入 `// <comment>` 可能让候选之间的空行、候选块结构错位。

Phase 1 处理：

- comment 插入位置严格：新 selected 候选上方一行，与候选名 token 同缩进。
- comment 为空时**不插入**；optimizer 可以选择不传 comment。
- specialize 做 idempotent 保护：如果候选上一行已经是 `// optimizer:` 开头
  的注释，先删旧再插新（避免多轮优化后堆叠注释）。
- 再次优化时只管理 optimizer 自己插入过的注释，用户手写的 `// ...` 不动。
  区分手段是匹配固定前缀，例如 `// optimizer: `。

### trial 并发下 LLM call 计数竞争

风险：`parallel for` 下多个 trial 同时调用 LLM，BudgetCounter 的
`incrementLlm` 需原子。

Phase 1 处理：

- BudgetCounter 内部用单线程 JS 环境的原子语义（Node 默认 single-threaded）；
  不需要 Mutex。
- 但需要让 `incrementLlm` 在 **抛错之前** 完成计数更新，以保证 partial
  failure 后 report 能看到准确数字。
- 超限 error 抛出后，`parallel for` 的其它并发 trial 会收到中断；这些中断
  的 LLM 调用不保证被算入计数。Phase 1 接受这个小偏差；文档说明。

### target 内 host tool 造成真实外部调用

风险：用户 `target.as` 里 `import tool Search from "host://search"`，optimizer
连跑 N 次 trial 会真实打到用户后端。

Phase 1 处理：

- v6-design 已决策：Phase 1 不 mock，只发 warning。CLI `--allow-target-tool`
  抑制已审计 tool 的 warning。
- tutorial 引导用户在 optimizer run 前重点审计 target imports。
- Phase 2 再考虑实际 mock / deny。

### 无依赖约束下手写 diff

风险：手写 unified-ish diff 不够精确，IDE 审阅体验差。

Phase 1 处理：

- 仅在 `write: "preview"` 的返回中使用；`copy` / `in_place` 路径不依赖 diff。
- optimizer 作者若需要精确 diff，可自行在产品侧用 `git diff` 外部对比
  original 与 output。
- 未来可引入内建 dep（`diff-match-patch` 体积小），但 Phase 1 保持 zero dep。

## 完成标准

V6 Phase 1 完成时应满足：

- `host://agentscript` toolchain 可用，三原语契约稳定。
- `ExecuteOptions.variant` 使用 label-based site_id；trace `variant.site_id`
  一致。
- `inspect` 不执行 target；`specialize` 纯源码操作；`trial` 走标准
  `executeAgent`。
- soft / hard error 边界符合设计。
- CLI `agentscript optimizer.as ./target.as --...` 可用；budget flag 生效。
- `parallel for` body 允许 `AgentScript.trial(...)` 并发执行，但拒绝
  `AgentScript.specialize(...)` 这类源码写回操作。
- `--check` 不触发 host 回调。`--dry-run` 会正常运行 optimizer.as，因此会触发
  optimizer 显式调用的 inspect / trial / specialize；它只通过 `input.dry_run`
  约定让 optimizer 把 specialize 切到 `write: "preview"`。
- 至少一个 `examples/optimizer/` 完整示例可以通过 `--mock` 端到端跑完。
- `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build`
  通过。
- CHANGELOG、language.md、optimizer.md、README 更新到位。
- 不新增 runtime npm dependency。
