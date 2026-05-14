# 优化器工具链

这是整个系列里最长的一篇。它把前面的概念串起来：

- `use one of` 创建有名字的 context choices。
- optimizer 本身是一个普通 AgentScript 程序。
- `host://agentscript` 给 optimizer 三个工具：`inspect`、`trial` 和 `specialize`。
- optimizer 的产物仍然是普通 `.as` 源码。

<img src="/img/tutorial-11.png" alt="优化器工具链教程概览" width="900" />

这篇使用可运行示例：[`../../../examples/optimizer/`](https://github.com/rongzhou/agentscript/tree/main/examples/optimizer/)。

## 1. 要优化的 Target

target 程序是 [`../../../examples/optimizer/triage.as`](https://github.com/rongzhou/agentscript/blob/main/examples/optimizer/triage.as)：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent Triage {
    model Qwen
    role "Support triage"
    description "Classify a support request with explicit selectable context policy."

    main func(input {
        request: string
    }) {
        use one of {
            concise: "Use a concise one-paragraph triage style." selected
            detailed: "Use a detailed triage style with rationale and next steps."
        } as style

        use input.request as "support request"

        generate({ input: "Triage the support request", max_output: 500 }) -> {
            priority
            summary
            next_steps: list[string]
        }
    }
}
```

这里有一个 choice point：

```agentscript
use one of {
    concise: "Use a concise one-paragraph triage style." selected
    detailed: "Use a detailed triage style with rationale and next steps."
} as style
```

源码当前默认选择 `concise`。optimizer 会 trial `detailed`，然后 preview 一段源码改写：把 `selected` 移到 `detailed` 上。

## 2. Optimizer 程序

optimizer 是 [`../../../examples/optimizer/optimizer.as`](https://github.com/rongzhou/agentscript/blob/main/examples/optimizer/optimizer.as)：

```agentscript
import tool AgentScript from "host://agentscript"

main agent Optimizer {
    main func(input {
        target: string
        request: string
        selection: json
        write: string
        trial_trace: string
        output: string
        dry_run: boolean
    }) {
        inspected = AgentScript.inspect({
            target: input.target
        })

        trial = AgentScript.trial({
            target: input.target,
            input: {
                request: input.request
            },
            selection: input.selection,
            trace: input.trial_trace
        })

        write_mode = input.write
        if input.dry_run {
            write_mode = "preview"
        }

        specialized = AgentScript.specialize({
            target: input.target,
            selection: input.selection,
            write: write_mode,
            output: input.output
        })

        {
            inspected: inspected,
            trial: trial,
            specialized: specialized
        }
    }
}
```

这不是语言里的特殊 runtime mode。它就是一个普通 AgentScript 程序，只是显式 import 了一个 host tool。

## 3. 理解 Optimizer CLI 模式

当 CLI 收到两个位置参数 `.as` 文件时，会进入 optimizer 模式：

```bash
agentscript optimizer.as target.as --key value
```

第二个文件会变成 optimizer 的 `input.target`。其它 flag 会进入 input：

- `--request "..."` → `input.request`
- `--selection '{...}'` → `input.selection`
- `--trial-trace none` → `input.trial_trace`
- `--write preview` → `input.write`

`--max-trials`、`--max-llm-calls`、`--max-seconds`、`--run-dir` 和 `--trace-file` 这类 runtime flag 由 runner 使用，不会进入 optimizer input。

## 4. 先跑 Preview

在仓库根目录运行：

```bash
npm run agentscript -- examples/optimizer/optimizer.as examples/optimizer/triage.as \
  --mock \
  --request "Checkout is failing with 500 errors in production" \
  --selection '{"examples/optimizer/triage.as#Triage.main[style]":"detailed"}' \
  --write preview \
  --output /tmp/triage.optimized.as \
  --trial-trace none
```

使用 `--mock` 时不会调用真实模型。这是检查 workflow shape、输出字段、source diff 和 CLI flag 映射的最安全方式。

## 5. 阅读 `inspect`

`AgentScript.inspect` 会解析 target，但不会执行 target。它的结果包括 target files、snapshot id、variant sites、baseline selection 和 warnings。

最重要的字段是 `variant_sites`。这个例子里你会看到类似这样的 site id：

```text
examples/optimizer/triage.as#Triage.main[style]
```

格式是：

```text
path#Agent.func[label]
```

这个稳定 id 会被 `selection` 使用。

## 6. 阅读 `trial`

`AgentScript.trial` 用指定 selection 运行 target：

```json
{
  "examples/optimizer/triage.as#Triage.main[style]": "detailed"
}
```

结果包括：

- `result`：target 程序输出
- `picked`：实际运行时选中了哪些 variants
- `unreached_selection`：selection 中没有被执行到的 site
- `warnings`：非致命问题
- `trace` / `trace_ref`：可选 trial trace

真实 optimizer 会在这里用 fixtures、evaluator、LLM judge 或下游指标给 candidate 打分。

## 7. 阅读 `specialize`

`AgentScript.specialize` 会改写源码选择。preview 模式不会写文件，只返回 diff：

```diff
-            concise: "Use a concise one-paragraph triage style." selected
-            detailed: "Use a detailed triage style with rationale and next steps."
+            concise: "Use a concise one-paragraph triage style."
+            detailed: "Use a detailed triage style with rationale and next steps." selected
```

这是核心设计点：学习结果是普通 AgentScript 源码，不是隐藏的 prompt tweak 数据库。

## 8. 写入 Copy

preview 看起来没问题后，可以写一个优化副本：

```bash
npm run agentscript -- examples/optimizer/optimizer.as examples/optimizer/triage.as \
  --mock \
  --request "Checkout is failing with 500 errors in production" \
  --selection '{"examples/optimizer/triage.as#Triage.main[style]":"detailed"}' \
  --write copy \
  --output /tmp/triage.optimized.as \
  --trial-trace none \
  --quiet
```

先用 `copy`，再考虑 `in_place`。`copy` 不会修改原 target。

## 9. 使用 Runtime Limits

optimizer run 可能变贵，所以 CLI 提供硬上限：

```bash
agentscript optimizer.as target.as \
  --max-trials 20 \
  --max-llm-calls 100 \
  --max-seconds 600
```

超过上限时，runner 会抛出 `BUDGET_EXCEEDED`。这些 flag 不是 optimizer input，而是保护整个运行过程。

## 10. Dry Run 惯例

`--dry-run` 会把 `input.dry_run` 设给 optimizer。示例使用这个惯例强制 preview：

```agentscript
write_mode = input.write
if input.dry_run {
    write_mode = "preview"
}
```

CLI 不会偷偷改写你的 optimizer 逻辑。optimizer 自己决定如何解释 `input.dry_run`。

## 11. 安全检查清单

写入优化源码前：

- 运行 `inspect` 并检查 warnings。
- 用显式 `selection` 运行 `trial`。
- 从 `write: "preview"` 开始。
- 优先使用 `write: "copy"`，再考虑 `write: "in_place"`。
- 真实 optimizer run 要设置 runtime limits。
- 检查 target imports，尤其是 effectful tools。

## 12. 继续扩展

这个示例只做一次手动 selection。更完整的 optimizer 可以：

- inspect 所有 variant sites
- 生成 candidate selections
- 运行多次 `trial`，必要时用 `parallel for`
- 用 fixtures 给结果打分
- 选择 winner
- 最后只调用一次 `specialize`

核心思想不变：优化结果修改的是源码里的 context choices，而不是不可见的 prompt 状态。
