# Optimizer Toolchain

AgentScript 可以用一个 optimizer 程序优化另一个 target 程序：

```bash
agentscript optimizer.as target.as --mock --trace-level none
```

在 optimizer 模式下，第二个位置参数会映射为 `input.target`。其它
`--key value` 和 `--key=value` flag 会进入 optimizer input，并把 `-`
转换为 `_`。`--max-trials`、`--max-llm-calls`、`--max-seconds`、
`--run-dir` 和 trace 相关 flag 是 runner 保留项，不会进入 input。

内置工具链这样导入：

```agentscript
import tool Optimizer from "host://optimizer"
```

## 方法

- `Optimizer.inspect({ target })` 只解析和分析 target，不执行 target。返回
  variant sites、baseline selection、snapshot id 和 warnings。
- `Optimizer.trial({ target, input, selection, snapshot_id, trace })` 通过标准
  `executeAgent` 运行 target，返回 result、picked variants、未命中的 selection、
  usage、warnings 和可选 trace。
- `Optimizer.specialize({ target, selection, snapshot_id, write, output })`
  改写源码选择。`write: "preview"` 只返回 diff，`"copy"` 写优化副本，
  `"in_place"` 更新变更文件。

site id 使用 label-based 格式：

```text
path/to/file.as#Agent.func[label]
```

同一作用域内重复 label 会追加 ordinal，例如 `[label#2]`。

完整的 mock 示例见 `examples/optimizer/`。
