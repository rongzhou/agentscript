# AgentScript V6 Design

V6 的目标是让 AgentScript 在语言生态内部完成优化闭环：让用户能用一条命令
`agentscript optimizer.as ./target.as ...` 运行一个完全由 `.as` 写成的
optimizer，对目标 `.as` 程序里的 `use one of` 选择点做实验，并把优化结果以
"移动 `selected`"的形式写回到另一份普通 `.as` 源码。

V6 不引入新的语言原语。语言核心仍然只有 `use` 和 `generate`。V6 只把一条
host scheme `host://optimizer` 的 toolchain 加进 provider 层，让 `.as`
程序能够把另一份 `.as` 源码当作**源码工件**来 inspect / trial / specialize。

V6 的立场来自已有的 `use one of` 设计：

```text
Agent context as code, and learnable context selection as code.
Learning does not hide in runtime. Learning produces code.
```

优化不是一个黑盒 `optimize()`；不是一个内置策略框架；不是一个 runtime 自动
学习系统。优化是一个从源码到源码的纯函数：
`target.as + evaluation signal + optimizer.as → specialized target.as`。

## 设计定位

V6 不是一个通用优化框架，也不试图覆盖所有搜索算法。它服从 AgentScript 的
核心哲学：

- **显式 capability**：optimizer 访问目标源码必须经过显式
  `import tool Optimizer from "host://optimizer"`。
- **显式 prompt context**：toolchain 返回的 inspection / trial 结果是普通
  数据；它们是否进 prompt 由 optimizer.as 自己的 `use` 决定。
- **策略属于用户**：toolchain 只提供三个确定性原语
  （inspect / trial / specialize），不提供 grid / random / beam 等搜索策略。
  策略写在 optimizer.as，或作为可 import 的普通 `.as` helper 库存在。
- **学习产出源码**：优化结果默认是把 `selected` 移到胜出候选、保留整个
  `use one of` 结构。Flatten 是第二形态。运行时状态不持有优化结果。
- **小而可审计**：trials、selections、reports 全部以工件形式落盘。
  AgentScript 不引入 runtime dependency。

这和 DSPy 类 prompt-rewriting 优化器不同：V6 不优化提示词字面量。搜索空间
是**结构化的上下文选择**，由 `use one of` 显式声明。

## 目标

V6 Phase 1 支持：

- 新的 host tool scheme `host://optimizer`，暴露三个原语方法：
  - `Optimizer.inspect({ target })` — 解析目标源码，返回所有 `use one of`
    位点及其候选。
  - `Optimizer.trial({ target, input, selection, ... })` — 以指定 variant
    selection 运行目标 agent 一次，返回值、trace、usage、picked。
  - `Optimizer.specialize({ target, selection, output, mode, write })` —
    根据 selection 把 `selected` 移到胜出候选，产出 specialized `.as` 源码。
- CLI `agentscript optimizer.as [<target>] [--<key> <value> ...]` 的位置参数
  和 flag 参数映射到 optimizer 的 `main func(input)` contract。
- canonical selection 格式 `{ site_id → variant_name }` 贯穿 trial 与 specialize。
- trial 可显式指定 target 的入口 agent / function；未指定时沿用 target 的
  `main agent` / `main func`。
- multi-agent target 中的优化范围由 optimizer.as 策略层过滤
  `inspection.variant_sites` 决定，不需要新的 host 原语。
- inspect 返回 `snapshot_id`（target dependency graph hash）；specialize 对
  `snapshot_id` 的一致性做强校验。
- trial 的三档 trace 细粒度：`summary`（默认）、`full`、`none`。
- CLI 的成本硬上限：`--max-trials`、`--max-llm-calls`、`--max-seconds`。
- `--dry-run` 约定把 `input.dry_run` 设为 `true`，由 optimizer.as 在策略层
  把 specialize 的 `write` 降级为 `"preview"`。CLI 不跨过 optimizer.as 直接
  改 specialize 参数。
- Specialize 默认 structure-preserving（只移动 `selected`），
  `flatten` 作为可选模式。
- 默认 `write: "copy"` 写到 optimized copy。单文件 target 默认
  `<target>.optimized.as`；多文件 target graph 默认写到
  `<target-stem>.optimized/` 目录，并生成 graph-local optimized copy。
  `write: "in_place"` 必须显式；`write: "preview"` 只返回 diff 不落盘。
- Helper 库以普通 `.as` 的形式提供（grid、stats 等），通过 `import agent`
  导入；toolchain 不把策略打包成 host tool method。
- Evalset 是用户契约，toolchain 不感知其格式。
- `--check` 静态分析不调用任何 host 回调。

V6 Phase 1 不支持：

- 内置 `optimize()` 语法或关键字；优化仍然是一次普通的
  `executeAgent(optimizer.as, ...)` 调用。
- 通过 `import agent Target from "./target.as"` 操作目标源码。目标是源码
  工件，必须经 toolchain；`import agent` 是 runtime capability，不在此路径上。
- Prompt 文本的自动 rewriting：V6 从不改 generate 的 instruction。
- 把 `import agent` 当作 optimizer toolchain 的替代入口。Target 仍然必须经
  `Optimizer.inspect` / `trial` / `specialize` 作为源码工件处理；不过
  Phase 1 会把 target 的 `import agent` 依赖图纳入同一次 inspect / trial /
  specialize 范围。
- 策略 helper 的 host tool 封装（例如 `Stats.max_by`）。Helper 全部是 `.as`。
- Resume、checkpoint、中断续跑（trials.jsonl 已经落盘，但 Phase 1 不做
  resume 语义）。
- LLM 成本绝对金额计算（Phase 1 只按 call count 和 token 粗估）。
- Optimizer 递归自优化（语义上不堵死，文档里明说不推荐）。
- 优化过程中增删候选（optimizer 只移动 `selected`；增删候选是作者手动或
  更高级的工具动作）。
- 目标内 `use one of` 候选中引用 capability 的自动规避（交给 target 自身的
  semantic analysis，optimizer 只是执行者）。

## 与语言的关系

V6 语法不变。optimizer.as 本身是一个普通 AgentScript 程序：

```agentscript
import tool  Optimizer from "host://optimizer"
import tool  Fs          from "host://fs"
import agent Grid        from "./stdlib/grid.as"
import agent Stats       from "./stdlib/stats.as"
import llm   Qwen        from "openai://gpt-4.1-mini"

main agent GridSearchOptimizer {
    model Qwen
    role  "AgentScript context optimizer"
    description "Explicit grid search with LLM-as-judge."

    main func(input {
        target:  string
        evalset: string
        output:  string
        dry_run: boolean
    }) {
        inspection = Optimizer.inspect({ target: input.target })
        if not inspection.ok { return inspection }

        // `Fs.read_jsonl` 只是 evalset 加载的 placeholder；evalset 如何读入
        // 不在 V6 三原语范围，optimizer 可按项目自行选择 host://fs、
        // import file + 解析、或其它方式。
        records = Fs.read_jsonl({ path: input.evalset })
        cases   = records.items

        candidates = Grid.enumerate({
            sites:    inspection.variant_sites,
            baseline: inspection.baseline_selection,
            max:      256
        })

        results = parallel for candidate in candidates.items max 256 {
            evaluate_candidate({
                target:      input.target,
                snapshot_id: inspection.snapshot_id,
                candidate:   candidate,
                cases:       cases
            })
        }

        best = select_winner({
            results:         results,
            baseline_id:     "baseline",
            min_improvement: 0.03
        })

        patch = Optimizer.specialize({
            target:      input.target,
            selection:   best.selection,
            snapshot_id: inspection.snapshot_id,
            output:      input.output,
            mode:        "structure-preserving",
            write:       input.dry_run ? "preview" : "copy",
            comment:     best.comment
        })

        {
            ok:          true,
            changed:     best.changed,
            output:      patch.output,
            improvement: best.improvement
        }
    }
}
```

关键点：

- optimizer 是一个普通 agent；入口还是 `main agent` / `main func`。
- `Optimizer.*` 是 host tool 调用，与 `Search.search` 同构。
- trial 并发由现有 `parallel for` 原语承担。toolchain 不引入额外并发编排。
- `generate` 在 optimizer.as 里用于 LLM judge。它只是个 generate，和业务
  agent 没有结构差别。
- optimizer.as 的每一条 context（包括 inspection、cases、trial 结果）都必须
  经过 `use` 才能进入 judge 的 prompt。这和语言核心保持一致。

## 命令与调用形态

CLI：

```text
agentscript optimizer.as [<target>] [--<key> <value> ...] [--flag]
```

参数映射到 optimizer.as 的 `main func(input {...})` contract：

- 紧跟 `optimizer.as` 的第一个位置参数（若存在）自动映射为 `input.target`。
- `--key value` 对按 optimizer input contract 做基础解析：`string` 保持字符串，
  `number` 解析为数字，`boolean` 解析为布尔值，`json` / `list[...]` 按 JSON
  解析。没有 input contract 的字段（或 contract 未覆盖的字段）按字符串填入。
- bool flag：`--flag` 等价于 `input.flag: true`；`--no-flag` 等价于
  `input.flag: false`。flag 中的 `-` 被映射为 `_`（例如 `--dry-run` 映射到
  `input.dry_run`），以便与 contract 字段名对齐。
- 对 `input` 字段的类型要求完全由 optimizer.as 的 contract 决定。未声明
  字段、多余位置参数由 contract 校验器报错；CLI 不再另做一层校验。

CLI 同时接受一组**工程兜底**的运行时标志，这些标志不进入 `input`，而是作为
进程级硬约束：

```text
--max-trials <N>        上限：对 Optimizer.trial 的累计调用次数
--max-llm-calls <N>     上限：所有 generate 调用次数（含 target 与 optimizer）
--max-seconds <N>       上限：整个进程墙钟时间
--allow-target-tool <x> 显式放行 target 里的特定 host tool；可重复，或用逗号
                        分隔多个名字（例："--allow-target-tool Search,Memory"
                        或 "--allow-target-tool Search --allow-target-tool Memory"）
--run-dir <DIR>         指定本次 run 的工件目录，默认 .agentscript/optimizations/<timestamp>
--trace-level <level>   trace 等级（summary|full|none），默认 summary
```

达到任何硬上限时 toolchain 抛 `BUDGET_EXCEEDED` 错误，由 optimizer.as 决定
是否捕获并写 partial report。不在 optimizer.as 里捕获时，CLI 返回非零退出
码并把已完成的 trial 落盘。

## Target 与 snapshot

Target 是**源码工件**。入口 `target` 文件及其递归 `import agent` 依赖构成
一个 target dependency graph。toolchain 对这个 graph 做三件事：

1. 读取入口目标 `.as` 源码，并解析其 `import agent` 依赖。
2. 对 graph 做语义校验，抽取 graph 内每个 `.as` 文件中的 `use one of` 位点。
3. 计算 `snapshot_id`：对 graph 中每个 `.as` 文件的相对路径与规范化源码内容
   做 SHA-256，得到整个 graph 的 hash。

`snapshot_id` 贯穿 inspect → trial → specialize 三个调用：

- `inspect` 返回 `snapshot_id`。
- `trial` / `specialize` 可选接受 `snapshot_id`。若提供，toolchain 在执行前
  重新读取整个 graph 并比对 hash。
  - `trial` 不匹配：返回 `ok: true` 但在 `warnings` 中追加一条
    `snapshot_mismatch` warning，并继续执行（允许调试中原地改源码）。
  - `specialize` 不匹配：拒绝写入，返回 `{ ok: false, code: "snapshot_mismatch",
    expected, actual }`。
- 若不提供 `snapshot_id`，toolchain 不做校验（允许最简 optimizer 跳过）。

这让 "optimizer.as 跑到一半，target 被人改了" 这种场景**主动失败**而不是
静默写错。

## Toolchain 三原语

全部方法位于 `host://optimizer` 这一个 host tool binding。方法签名采用与
现有 host tool 一致的"JSON object 入参、JSON-safe 返回值"约定，不引入新
marshal 规则。

### inspect

入参：

```json
{
  "target": "./target.as"
}
```

返回：

```json
{
  "ok": true,
  "target": "./target.as",
  "snapshot_id": "sha256:e3b0c...",
  "files": ["target.as", "agents/researcher.as"],
  "variant_sites": [
    {
      "site_id": "target.as#Researcher.main[evidence]",
      "label": "evidence",
      "scope": { "kind": "function", "agent": "Researcher", "func": "main" },
      "selected": "combined",
      "default_reason": "selected",
      "candidates": [
        { "name": "none",         "empty": true,  "budget": null },
        { "name": "lesson_only",  "empty": false, "budget": { "amount": 2, "unit": "k" } },
        { "name": "doc_only",     "empty": false, "budget": { "amount": 4, "unit": "k" } },
        { "name": "combined",     "empty": false, "budget": { "amount": 4, "unit": "k" } }
      ]
    }
  ],
  "baseline_selection": {
    "target.as#Researcher.main[evidence]": "combined"
  },
  "warnings": []
}
```

规则：

- `inspect` 不执行 target。它只运行 parser + semantic analyzer。
- `files` 列出本次 target dependency graph 中参与 inspect / snapshot /
  specialize 的 `.as` 文件，路径使用和 site_id path 段一致的规范化规则。
- `scope.kind` 取值为 `"agent"` 或 `"function"`。`"agent"` 表示 agent-level
  `use one of`，`func` 段在 site_id 中缺省；`"function"` 覆盖函数体内以及
  函数内 block（`if` / `for` / `loop` / `repeat` / `parallel for`）中的
  `use one of`——块级作用域不引入新的 `scope.kind` 值，因为作用域可见性
  对 optimizer 搜索空间语义并无差别。
- `candidates[].budget` 使用与 `use` trace 相同的 `{ amount, unit }` 形态
  （`unit` 可选）；未声明 budget 时为 `null`。
- `default_reason` 取值 `"selected"` 或 `"first"`，与 `variant.reason` 的定义
  对齐，记录 source-level 默认的来源。
- 若 target 无 `use one of`，返回 `ok: true` 与空 `variant_sites`，并追加
  一条 warning（`code: "no_variant_sites"`），帮助用户发现"目标不可优化"。
- semantic 错误以 `{ ok: false, code: "semantic_error", diagnostics }` 返回；
  不抛 RuntimeError。让 optimizer.as 可以把错误写进 report 而不是中断。
- `scope` 字段帮助 optimizer.as 分组、报告。

### trial

入参：

```json
{
  "target": "./target.as",
  "entry": { "agent": "Researcher", "func": "main" },
  "input": { "question": "..." },
  "selection": {
    "target.as#Researcher.main[evidence]": "doc_only"
  },
  "snapshot_id": "sha256:e3b0c...",
  "trace": "summary",
  "run_id": "optional-string-for-trial-grouping"
}
```

返回：

```json
{
  "ok": true,
  "result": { "ok": true, "answer": "..." },
  "usage": {
    "prompt_tokens": 1320,
    "output_tokens": 220,
    "total_tokens": 1540,
    "llm_calls": 1,
    "latency_ms": 840
  },
  "picked": {
    "target.as#Researcher.main[evidence]": {
      "variant": "doc_only",
      "reason": "trial",
      "empty": false
    }
  },
  "unreached_selection": [],
  "warnings": [],
  "trace": null,
  "trace_ref": ".agentscript/optimizations/<run>/trials/<trial-id>.jsonl"
}
```

规则：

- `entry` 可选。未指定时，toolchain 按普通 `executeAgent` 规则选择 target 的
  `main agent` 与入口函数。multi-agent 文件中需要评测非默认入口时，optimizer
  应显式传入 `entry`。
- `selection` 是 partial 合法的：未指定的 site 回落到源码 `selected`，再回落
  到 first candidate。这与现有 variant 选择优先级一致（runtime hint >
  source `selected` > first）。
- `selection` 中出现未知 `site_id` 或未知 variant name 时，trial 返回
  `{ ok: false, code: "unknown_selection_key" | "unknown_variant" }` 与定位
  信息；不要静默忽略。拼写错误如果被忽略，会污染评测结果。
- `picked` 记录本次执行过程中实际遇到的所有 `use one of` site，包括
  selection 未覆盖、按 source default 选择的 site。这样 report 能解释"哪些
  变量被试验覆盖，哪些保持默认"。如果 trial 结束时还有 `selection` 中的 site
  没有被执行到（例如位于未进入的分支），`picked` 中不出现；但返回值额外带
  `unreached_selection` 数组列出这些 site_id，让 optimizer 能察觉 selection
  里的"死 key"。
- `trace: "summary"`（默认）：toolchain 把完整 trace 落盘到 `trace_ref`
  指向的 JSONL 文件；`trace` 字段返回 `null`。避免几百个并发 trial 把内存
  打爆。
- `trace: "full"`：把 trace inline 填到返回值的 `trace` 字段；`trace_ref`
  仍落盘，便于后续审计。
- `trace: "none"`：不落盘也不 inline。`trace_ref` 返回 `null`。用于压力测试
  或最终稳态评测。
- trial 的成功返回值可选带 `warnings` 数组，每条形如
  `{ code, message, ... }`。已定义的 code 包括 `snapshot_mismatch`、
  `target_effectful_tool`。`warnings` 不改变 `ok: true` 语义。
- target 的 LLM / tool / memory provider 沿用 `executeAgent` 当前 runtime 的
  registry。V6 Phase 1 不提供对 target 内 provider 的重定向；该能力留给
  Phase 2（见"已收敛决策与开放问题"）。
- target 中任何标记为 effectful 的 tool（`host://` 除 agentscript 自身、
  `npm:`、`node:`、`mcp:`、`sh:` 等）在 trial 执行时**真实触发**。toolchain
  在 inspect 阶段对 target 里这些 tool import 发出一次 warning；CLI
  `--allow-target-tool` 用于抑制已审计 tool 的 warning。真正的 mock / deny
  策略留给 Phase 2。
- 成本硬上限由 toolchain 级计数器强制执行。每次 trial 把 `llm_calls`
  累加到全局配额；超限抛 `BUDGET_EXCEEDED`（进程级 hard error，不是 soft
  `ok: false`）。

### specialize

入参：

```json
{
  "target": "./target.as",
  "selection": { "target.as#Researcher.main[evidence]": "doc_only" },
  "snapshot_id": "sha256:e3b0c...",
  "output": "./target.optimized.as",
  "mode": "structure-preserving",
  "write": "copy",
  "comment": "grid search winner, F1 0.84 vs baseline 0.79",
  "fill_missing": "source_default"
}
```

返回：

```json
{
  "ok": true,
  "changed": true,
  "output": "./target.optimized.as",
  "outputs": ["./target.optimized.as"],
  "diff": "...unified diff string...",
  "edits": [
    {
      "site_id": "target.as#Researcher.main[evidence]",
      "file": "target.as",
      "label": "evidence",
      "from": "combined",
      "to": "doc_only"
    }
  ],
  "snapshot_id": "sha256:e3b0c..."
}
```

规则：

- `mode: "structure-preserving"`（默认）：只移动 `selected` token；保留候选
  顺序、候选内部格式、注释、空白。
- `mode: "flatten"`：把 `use one of {...} as label` 塌缩为单条 `use expr
  [max budget] as label`；`empty` 胜出时整条 `use` 被删除。
- `write: "copy"`（默认）：写入 optimized copy，不覆盖原文件。单文件 target
  默认文件名为 `<target>.optimized.as`；多文件 target graph 默认写入
  `<target-stem>.optimized/` 目录，按 graph 相对路径复制 `.as` 文件并改写
  selection 涉及的文件。若显式给定 `output`，单文件时它是输出文件，多文件
  时它必须是输出目录。多文件 copy 必须保持 `import agent` 依赖仍指向 copy
  graph 内的对应 `.as` 文件；非 AgentScript 资源 import 不在 Phase 1 的
  graph 范围内，若需要可由用户在外层工程脚本复制。
- `write: "in_place"`：覆盖 selection 涉及的原文件。多文件 graph 下可能覆盖
  多个 `.as` 文件，因此必须显式使用，不允许作为默认。
- `write: "preview"`：只返回 `diff` 与 `edits`，不落盘。
- `output` 是主输出位置：单文件时是输出文件；多文件时是输出目录。`outputs`
  列出本次实际写入或 preview 涉及的所有文件，便于 CI / report 精确展示。
- `snapshot_id` 不匹配时返回 `{ ok: false, code: "snapshot_mismatch",
  expected, actual }`，不写文件。
- `fill_missing: "source_default"`（默认）：selection 未覆盖的 site 按源码
  `selected` / first 处理，不做任何修改。换言之，specialize 只改写
  selection 中显式覆盖的 site；未覆盖 site 不会因为"解析出默认值"而被重写。
- `fill_missing: "require"`：selection 必须覆盖所有 site，否则返回
  `{ ok: false, code: "incomplete_selection", missing_sites }`。这是推荐给
  生产 pipeline 的严格模式。
- selection 中出现未知 `site_id` 或未知 variant name 时，specialize 返回
  `{ ok: false, code: "unknown_selection_key" | "unknown_variant" }`，拒绝
  写入。source-to-source 写回不能容忍拼写错误。
- `comment` 可选，按约定在胜出候选上方插入一行 `// <comment>`。

specialize 的 token-level 改写基于现有 AST `range` 信息。它只动"候选值的
尾部修饰区"：删除旧 `selected` 关键字，在新候选尾部插入 `selected`。不涉及
AST → source pretty-print，避免破坏作者手写格式。

### 错误模型

三原语统一使用同一套错误表达：

- **soft error**：可被 optimizer.as 捕获、写入 report、继续或放弃的错误。
  通过返回 `{ ok: false, code, message, ... }` 表达。每种 code 的额外字段
  在各自原语的规则里列出。常见 code 包括
  `semantic_error`、`snapshot_mismatch`、`incomplete_selection`、
  `unknown_selection_key`、`unknown_variant`、`no_variant_sites`（以 warning
  形式出现）。
- **hard error**：进程级失败，以 `RuntimeError` 抛出。仅限于三类：
  - host IO 失败（读不到 target 文件、写输出文件失败等）；
  - toolchain 用量上限 `BUDGET_EXCEEDED`；
  - optimizer.as 传入的参数违反 tool schema（非 object 入参、字段类型错误等）。
- soft error 的 `code` 是稳定的机读字符串；`message` 面向人读，不保证稳定。
  optimizer.as 和外部工具应按 `code` 分支，不要按 `message` 匹配。

## Site ID 与命名稳定性

Phase 1 的 `site_id` 采用 label-based 格式：

```text
<relative_path>#<agent_name>.<func_name>[<label>]
```

- 函数级 / block 级 `use one of`：`target.as#Researcher.main[evidence]`。
- agent 级 `use one of`：`target.as#Researcher[playbook]`（缺省 func 段）。
- 同 label 多次出现：在 label 上追加 `#N`，其中 `N` 从 `2` 开始按源码出现
  顺序编号（第 1 次不带后缀）。例：`target.as#Researcher.main[evidence]` 与
  `target.as#Researcher.main[evidence#2]`。
- path 统一使用 POSIX 分隔符。CLI 场景下相对于 CLI 启动目录（cwd）；嵌入
  `executeAgent` 场景下相对于 `ExecuteOptions.workspaceRoot`，若未提供则
  退化为绝对路径。同一 optimizer run 中 inspect / trial / specialize 共用
  同一套 base 规则，保证 site_id 串联一致。

好处：

- 对同文件内无关位置的增删、注释改动、变量重命名稳定。
- 人读直观。
- 不依赖 source offset。

旧实现中 `use` trace 的 `variant.site_id` 采用 `<path>:<line>:<column>`。
V6 统一到新的 label-based 格式。这是一次性替换；"cold start"阶段不保留
向后兼容。

site_id 仍然是**实现定义的位点标识**。它在同一 snapshot 内稳定；不保证跨
无关 refactor 的持久化。持久化优化结果始终通过移动源码 `selected` 完成，
不通过 site_id map。

## Selection 格式

canonical selection：

```json
{
  "target.as#Researcher.main[evidence]":  "doc_only",
  "target.as#Researcher.main[examples]":  "none"
}
```

- toolchain 的 trial / specialize 只接受 canonical selection。
- optimizer.as 内部可以使用 friendly 展示（如 `{ evidence: "doc_only" }`），
  但只用于 report。label 可能冲突，不能作为唯一持久键。
- helper 库可以提供 `friendly_to_canonical` / `canonical_to_friendly`
  两个函数；Phase 1 建议放在 stdlib `selection.as` 里。

## 跨 agent 场景（近期需求）

一个 `target.as` 程序可以包含多个 agent、跨 agent 调用（通过内部 `agent`
import 或作为 sub-agent），这是已存在的语法。跨 agent 情况下 optimizer 仍
然只做一件事：**在目标程序的入口以指定 variant selection 跑一次
`executeAgent`**。

关键语义：

- **单文件多 agent**：inspect 扫整个文件，`variant_sites` 按 `scope.agent`
  字段分组。trial 的 `selection` 是全局 map，会被每个 agent 的 scope 解析
  引擎正确消化。
- **单 executeAgent 调用内的跨 agent 传递**：当 agent A 在 body 内调用
  agent B（例如作为 sub-agent），B 体内的 `use one of` site 对 A 不可见，
  但对 trial 可见——`selection` 是全局，toolchain 把它一并传给
  `ExecuteOptions.variant`。site_id 用 `<path>#<agent>.<func>[<label>]`
  自然区分 A、B 的 site。
- **agent 级 `use one of`**：`variant_sites` 里 `scope.func` 留空；selection
  仍然用 `<path>#<agent>[<label>]`。
- **多文件 target**：AgentScript 的运行时已经支持 `import agent`，所以 V6
  Phase 1 把入口 target 及其递归 `import agent` 依赖视为一个 target
  dependency graph。inspect 返回整个 graph 中所有 `.as` 文件里的
  `use one of` sites；site_id 的 path 段指向 site 所在文件；trial 的
  selection map 可以混合多个 path；specialize 按 site 所在文件分别生成改写。

### 指定优化哪些 agent

V6 不为"优化范围"增加第四个原语。优化范围是 optimizer.as 的策略输入：
optimizer 先 `inspect` 整个 target，再按 `variant_sites[*].scope` 过滤出
本次要枚举的位点。未进入过滤结果的 site 不进入 candidate enumeration，也
不进入 `selection`。

典型策略（示例中 `Selection` / `Grid` 是前文 Helper 库一节引导复制的
`.as` helper，不是 host tool）：

```agentscript
import agent Selection from "./stdlib/selection.as"
import agent Grid      from "./stdlib/grid.as"

inspection = Optimizer.inspect({ target: input.target })

sites = Selection.filter_sites({
    sites:  inspection.variant_sites,
    agents: input.agents,
    funcs:  input.funcs
})

candidates = Grid.enumerate({
    sites:    sites,
    baseline: inspection.baseline_selection,
    max:      256
})
```

因此：

- 只优化某个 agent：过滤 `site.scope.agent in input.agents`。
- 只优化某个 agent 的某个函数：同时过滤 `site.scope.agent` 与
  `site.scope.func`。
- 只优化 agent-level context：过滤 `site.scope.kind == "agent"`。
- 只优化被入口 agent 间接调用的 sub-agent：trial 仍从 target 入口运行，
  但 `selection` 只包含 sub-agent 的 site_id；入口 agent 自己的 site 回落到
  source default。

这个设计依赖两个不变式：

- `inspect` 必须返回全 target 的 `variant_sites`，不只返回入口 agent
  可静态直达的位点。优化器需要先看见完整搜索空间，再决定过滤范围。
- `trial` / `specialize` 必须接受 partial selection。这样未被选入优化范围的
  site 能保持源码默认行为，并且不会在 specialize 时被重写。

如果用户希望更强的生产约束，可以在 optimizer.as 里检查过滤结果是否为空，
或在 specialize 阶段使用 `fill_missing: "require"` 要求 selection 覆盖本次
策略定义的全部 sites。注意 `fill_missing: "require"` 的"全部"按传给
specialize 的 target 全部 sites 判定；若只想对过滤范围严格，optimizer 应
先在策略层验证范围覆盖，再以 `source_default` 写回。

### 对 V6 设计的硬要求

跨 agent 场景在 V6 对外契约上只需要两条强约束成立：

1. `site_id` 用 `<path>#<agent>.<func>[<label>]` 区分不同 agent 的位点，
   label-based 格式已满足。
2. inspect 必须把 target dependency graph 中每个 `.as` 文件、每个 agent 的
   `use one of` 全部列出（包括仅由 sub-agent 调用到的 agent）；
   `variant_sites` 是 graph 级视图，不是"入口 agent 可静态直达"的视图。

这两条成立后，trial / specialize 都不需要感知"跨 agent"这一概念；
multi-agent target 对 toolchain 只是"同一个 target graph 里有更多 sites"。

V6 Phase 1 的 CLI demo / tutorial 可以保持单文件 target 形式，但实现必须
覆盖跨文件 `import agent` target，因为这是语言已经承诺的现有能力。

## 并发与成本控制

trial 并发完全依赖 AgentScript 自己的 `parallel for`：

```agentscript
results = parallel for candidate in candidates.items max 256 {
    evaluate_candidate({
        target:      input.target,
        snapshot_id: inspection.snapshot_id,
        candidate:   candidate,
        cases:       cases
    })
}
```

并发度由现有 `ExecuteOptions.concurrency` / agent config 决定。optimizer.as
只负责表达"这些 trial 彼此独立"。

成本控制分三层：

1. **toolchain 硬上限**（CLI flag）：`--max-trials`、`--max-llm-calls`、
   `--max-seconds`。这是进程级守护，到达即抛。
2. **用户策略层上限**：optimizer.as 自己在 `make_candidates` / for 循环里
   用 `max` 语法限制候选数（语言本身就要求 `for` / `parallel for` 带 `max`）。
3. **目标侧防护**：target 内任何 effectful tool（`host://` 除 agentscript
   自身、`npm:`、`node:`、`mcp:`、`sh:` 等）在 Phase 1 默认真实触发；
   toolchain 给出一次 warning，`--allow-target-tool` 用于抑制已审计 tool
   的 warning。真正 mock / deny 策略留给 Phase 2。对 LLM generate 调用，
   toolchain 把调用计入 `llm_calls` 总数。

## Trace

toolchain 不发明新的 trace kind。host tool 调用保持现有 `tool` kind：

```json
{
  "kind": "tool",
  "data": {
    "tool": "AgentScript",
    "method": "trial",
    "scheme": "host",
    "uri": "host://optimizer",
    "args": [ { "selection": {...}, "..." } ],
    "result": {
      "ok": true,
      "usage": { "llm_calls": 1, "prompt_tokens": 1320 },
      "trace_ref": ".agentscript/optimizations/<run>/trials/<trial-id>.jsonl"
    }
  }
}
```

规则：

- outer trace（optimizer.as 自己的 trace）里每次 `trial` 留一条 tool event。
- inner trace（target 的执行轨迹）落盘到 `trace_ref` 指向的 JSONL。
- `trace: "full"` 时 inner trace 额外 inline 到 result，但仍落盘。
- `variant.*` 字段在 inner trace 的 `use` event 上保留不变，已由 `use one of`
  设计规定。

所有 trials 的 jsonl 合并后仍然是合法的 trace 序列；外部工具可以把
`target.as` 作为 replay 单位来审计任意一次 trial 的实际上下文。

## Helper 库

策略、统计、JSON 辅助全部写成 `.as` 源码，通过 `import agent` 使用。Phase 1
建议把 helper 放在仓库内 `examples/optimizer/stdlib/`，由 tutorial 引导
用户复制到项目：

```agentscript
import agent Grid       from "./stdlib/grid.as"
import agent Random     from "./stdlib/random.as"
import agent Stats      from "./stdlib/stats.as"
import agent Selection  from "./stdlib/selection.as"
import agent Report     from "./stdlib/report.as"
```

原则：

- 所有 helper 必须是普通 `.as`，可读、可 diff、可 fork。
- toolchain 不把策略封装成 host tool method（避免黑盒）。
- 未来若需要独立 npm 发布，可以把 `examples/optimizer/stdlib/` 升级为
  `@agentscript/stdlib` 包，import 路径由 `./stdlib/grid.as` 切换为
  `@agentscript/stdlib/optimize/grid.as`；该升级是 Phase 2 之后的工作，
  不阻塞 V6 闭环。
- 需要纯 JS 能力（如 hash、高斯随机）的 helper 写一层薄 host tool；纯数据
  helper 不走 tool。Phase 1 不需要任何纯 JS helper——grid / stats 用普通
  AgentScript 表达已经足够。

helper 不是 Phase 1 的 blocker：用户完全可以把策略直接写在 optimizer.as
里。stdlib 只是提升工效的可选物。

## optimizer.as 典型形态

推荐的 main func contract（社区约定，不强制）：

```agentscript
main func(input {
    target:  string
    evalset: string
    output:  string
    dry_run: boolean
    run_id:  string
}) {
    ...
    {
        ok:          boolean
        changed:     boolean
        output:      string
        report:      string
        improvement: number
    }
}
```

CI 工具或外层编排脚本能按字段读取结果，不必 parse report。

## Safety defaults

以下行为在 Phase 1 里默认启用：

- **默认不覆盖源文件**：`write: "copy"`。单文件 target 输出到
  `<target>.optimized.as`；多文件 target dependency graph 输出到
  `<target-stem>.optimized/` 目录。
- **snapshot 校验**：optimizer.as 只要把 `inspection.snapshot_id` 透传给
  specialize，就拿到一致性保护。
- **dry-run 靠策略层配合**：CLI `--dry-run` 仅把 `input.dry_run` 设为
  `true`；是否把 specialize 的 `write` 降级为 `"preview"` 由 optimizer.as
  决定。推荐惯例：optimizer.as 在收到 `input.dry_run == true` 时把
  `write: "preview"` 传给 specialize，并把 preview 的 `diff` 写进 report。
  CLI 不跨过 optimizer.as 直接改 specialize 参数。
- **budget 硬上限**：默认 `--max-trials 1000`、`--max-llm-calls 10000`、
  `--max-seconds 1800`。`0` 表示无上限，需要显式指定。
- **target tool warning**：Phase 1 对 target 里 effectful tool（`host://`
  除 agentscript 自身、`npm:`、`node:`、`mcp:`、`sh:` 等）给出 warning；
  `--allow-target-tool <names>` 显式标记已审计 tool 并抑制 warning。真正
  mock / deny 作为 Phase 2 策略。
- **友好错误**：
  - 目标文件无 `use one of`：inspect 返回 `ok: true`、空 `variant_sites` 和
    一条 `no_variant_sites` warning。optimizer.as 通常在这种情况下返回
    `{ ok: true, changed: false }`；CLI 检测到 `changed == false` 时在
    终端打印"nothing to optimize"提示，退出码为 0。
  - 目标存在 multiple `selected`：parser 已经拦住（`use one of` 设计规定
    最多一个 `selected`）；inspect 再次校验，若出现则返回 `semantic_error`
    与定位信息。

## capability 与边界

V6 不改变 capability 模型：

- `import tool Optimizer from "host://optimizer"` 是显式 capability。
- 宿主可以通过 registry 决定是否授予这个 tool；CLI 默认授予，嵌入式
  `executeAgent` 不默认授予。
- host tool 返回值不自动进入 prompt；任何 inspection / trial 结果要进
  optimizer 的 judge prompt，必须被显式 `use`。
- target 内的 import 完全由 target 自己的代码决定；toolchain 不"补"import。
- optimizer.as 的 scope 规则不变。optimizer.as 自身可以使用 `use one of`
  （例如让 judge prompt 的 instruction context 可选择），那只是普通的
  AgentScript 语义，与"用 optimizer 优化 optimizer"（递归自优化）不同。
  后者在 Phase 1 语义上允许、但文档中不推荐。

## 与 IR 的未来迁移（中期考量）

当前解释器是 tree-walking，直接跑 AST。V6 的设计要让将来引入 IR 时不必
重新定义 optimizer 契约。具体策略：

### toolchain 的三原语与 IR 无关

- `inspect` 只依赖"从 target 源码能解出 `use one of` site + candidate
  元数据"；这是 parser + semantic 的产物。IR 阶段 parser 不消失；semantic
  结果仍能保留。inspect 返回值的 JSON schema 不引用任何 AST / IR 节点。
- `trial` 只依赖 `executeAgent(program, input, options)` 能够接受
  `variant` map。当运行时切到 IR 执行时，只要 IR 仍然保留 `use one of` 的
  site 结构与 hint 覆盖逻辑，trial 接口不变。
- `specialize` 是对**源码**的操作，不碰 AST / IR。即便 runtime 切到 IR，
  specialize 仍然基于源码 range 做 token 级 splice。

### site_id 与 IR 的兼容

label-based site_id 只依赖 `agent` / `func` / `label` 这三段信息。IR 阶段
仍然保留这些作为调试元数据是基本要求。site_id 不依赖 AST node id、IR
node id、offset。

### Variant hint 的下发

IR 化后，variant hint 会从 `ExecuteOptions.variant` 进入 IR pass，最终
影响 IR 节点（或等效运行时选择）。关键不变式：**IR 不能把
`selected` 优化掉**。每个 `use one of` 的候选必须在 IR 里仍然是可选择的
分支，而不是被 constant-fold 成"实际走的那条"。否则 trial 就变成跑固定
程序。

这对未来 IR 设计的约束：

- `use one of` 在 IR 里保留为一个显式的 "variant selector" 节点，候选作为
  子节点 / 子块。
- 变体选择在节点求值时刻基于 `variant` map + `selected` + `first`
  决定——和现在的 `pickUseOneOfCandidate` 同构。
- IR pass 可以对候选内部做常量折叠、死代码消除等，只要不改变选择语义。

### trace 稳定性

`use` trace event 的 `variant` 子对象（`site_id`、`picked`、`available`、
`reason`、`empty`）是 IR 和 tree-walking 共同的输出契约。IR 切换时必须
继续产生同样的字段。V6 的外部消费者（optimizer.as、report 工具）因此不会
因为 IR 化而失效。

### Specialization formatter 的独立性

Phase 1 的 `specialize` 是基于 AST `range` 的 token splicer。IR 化完全不
影响它：AST 仍然在（parser 产物），source text 仍然在。IR 只是 AST→IR
的一步新 pass，不是 AST 的替代。

结论：V6 toolchain 的对外契约（三原语入参/返参 JSON schema、site_id 格式、
`variant` trace 字段）被设计为 IR-agnostic。IR 引入时，实现层会变动——例如
`trial` 的 variant hint 走 IR pass 而非 tree-walking hot path——但 optimizer.as
与 report 工具无需修改。

## 非目标

V6 Phase 1 明确不做：

- 提供现成的 beam / bandit / Bayesian 搜索 helper；仅 grid + random 在
  stdlib 里作为示例。
- 自动计算美元成本；只暴露 token / call 计数。
- 断点续跑；trials 落盘但不持久化整体进度。
- 原地增删 `use one of` 候选；只移动 `selected` / flatten。
- Prompt 字面量的 source-to-source rewriting。
- 优化结果自动提交到 VCS；输出永远是本地文件。
- 通过语言新语法访问 optimizer toolchain；必须走 host tool。
- 让 optimizer.as 能读写任意文件；走 `host://fs` 这条显式 capability，
  和其它 host tool 一致。

## 实现建议与改进点

以下建议不是新语言能力，而是让 Phase 1 更稳、更容易实现的工程约束：

1. **先迁移 runtime site_id，再实现 toolchain**。`use one of` 当前 runtime
   已经有 `variant.site_id`，V6 应先把它统一到 label-based 格式，并让
   `ExecuteOptions.variant` 接受同一格式。inspect / trial / specialize
   共用一个 site_id builder，避免 trace 与 specialize 使用两套命名。
2. **把 inspect 做成纯源码分析**。inspect 不应依赖 runtime scope，也不应执行
   target。它只需要 parser + semantic + AST walker，输出 JSON-safe metadata。
3. **specialize 用 token splice，不做 pretty-print**。只删除旧 `selected`，
   在新候选尾部插入 `selected`，并保留注释、空白和候选顺序。Flatten 可以
   作为第二步实现，不阻塞 structure-preserving。
4. **trial 先实现最小闭环**。最小可用版本只需要 target / input / entry /
   selection / snapshot_id / trace level。`llm_override`、tool mock、resume
   都不要卡住第一版。
5. **优化范围放在 helper，不放进 host API**。推荐提供 `Selection.filter_sites`
   / `Selection.require_sites` 这类 `.as` helper。这样 multi-agent 范围控制
   是可读策略，而不是 hidden host behavior。
6. **trial artifacts 使用稳定目录结构**。建议每次 optimizer run 建立
   `.agentscript/optimizations/<timestamp-or-run-id>/`，其中 `inspection.json`、
   `trials/*.jsonl`、`results.jsonl`、`specialize.diff` 都是普通文件。以后
   做 resume 时可直接复用这些工件。
7. **错误返回优先于 RuntimeError**。host tool 原语面向 optimizer.as 调用，
   目标源码错误、未知 site、未知 variant、snapshot mismatch 等都优先返回
   `{ ok: false, code, message, ... }`，让 optimizer 能生成 report。只有
   budget hard limit、宿主 IO 失败等进程级错误才抛。

## 已收敛决策与开放问题

以下事项在本文档中已经收敛为 Phase 1 决策：

- optimizer.as 必须仍以普通 `main agent` / `main func` 启动；V6 不引入
  `optimize` 入口。
- inspect 要求 target 通过 semantic analyzer 全量检查；静态错误返回
  `ok: false` 与 diagnostics。
- `site_id` 对 agent-level `use one of` 采用缺省 func 段：
  `target.as#Researcher[playbook]`。
- trial 接受 partial selection；未覆盖 site 按 source default 选择。
- specialize 默认也接受 partial selection；未覆盖 site 不改写。
- multi-agent 优化范围由 optimizer.as 过滤 `variant_sites` 实现，toolchain
  不新增 range/filter 参数。
- target 内非 AgentScript host tool 在 Phase 1 只 warning、不 mock；
  `--allow-target-tool` 用于抑制已审计 warning。

仍需在实现前拍板或延后到 Phase 2 的问题：

- **target LLM / tool / memory provider 重定向**：trial 入参当前未暴露
  `llm_override` / `tool_override`。Phase 2 再决定是否开放；若开放，接口
  语义需覆盖 `openai://` / `anthropic://` 等 protocol URI 的替换。
- **stdlib 的分发形式**：Phase 1 明确放在仓库内
  `examples/optimizer/stdlib/`，由 tutorial 引导用户复制到项目目录。独立
  npm 包 `@agentscript/stdlib` 作为 Phase 2 之后的升级路径。
- **Phase 2 是否升级 target tool warning 为 mock / deny**：等 tutorial 和真实
  target 反馈后再决定。不要在 Phase 1 阻塞闭环。
- **多 target**：Phase 1 只允许单入口 target dependency graph。这个 graph
  可以包含递归 `import agent` 引入的多个 `.as` 文件与多个 agent；但不支持
  在一次 toolchain 调用里同时优化两个彼此独立的 target graph。若用户需要
  多 target 对比，可以多次调用 optimizer。

## 设计不变式

V6 Phase 1 完成后仍必须成立：

- 语言核心只有 `use` / `generate`；无 `optimize` 关键字。
- optimizer.as 是一个普通 `.as` 程序，入口仍是 `main agent` / `main func`。
- toolchain 三原语 `inspect` / `trial` / `specialize` 的入参/返参
  schema 固定，不依赖 AST 或 IR 细节。
- multi-agent 优化范围由 optimizer.as 过滤 `variant_sites` 表达，不成为新的
  language primitive 或 host tool method。
- `use one of` 的 `variant` trace 字段一致不变。
- `site_id` 在 inspect / trial / specialize / trace 中使用同一套 label-based
  格式。
- optimizer 的学习结果永远以**普通 `.as` 源码**形式存在，通过移动
  `selected` 或 flatten 完成。
- runtime 状态不持有优化结果。
- 每一条进入 judge prompt 的数据都必须经过显式 `use`。
- capability 模型不变：host tool 授权显式、可审计、可关闭。
- CLI 的 budget 硬上限优先于 optimizer.as 策略层；硬上限永远是最后的
  守护者。
- AgentScript runtime 不引入新的 npm dependency。
