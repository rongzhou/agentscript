# CLI 和 REPL 工作流

完成 quickstart 后，下一步最好先学会如何在终端运行、检查和调试 AgentScript 程序。

<img src="/img/tutorial-2.png" alt="CLI 和 REPL 工作流教程概览" width="900" />

这篇教程使用两个小文件：

- [`../../../tutorials/cli.as`](https://github.com/rongzhou/agentscript/blob/main/tutorials/cli.as)
- [`../../../tutorials/repl.as`](https://github.com/rongzhou/agentscript/blob/main/tutorials/repl.as)

## 1. 查看帮助

先看内置帮助：

```bash
agentscript --help
```

如果你在仓库里工作，可以用：

```bash
npm run agentscript -- --help
```

## 2. 带输入运行

`tutorials/cli.as` 需要 `name` 和 `request`：

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent {
    model Qwen
    role "CLI Assistant"
    description "Answer a short request from a command-line user."

    main func(input {
        name: string
        request: string
    }) {
        use input.name
        use input.request

        generate({ input: "Reply to the CLI user by name", max_output: 300 }) -> {
            ok: boolean
            message
        }
    }
}
```

用 mock 输出运行：

```bash
agentscript tutorials/cli.as --mock --input '{"name":"Rong","request":"Say hello"}'
```

开发时优先使用 `--mock`。它会检查程序形状，但不会调用真实模型。

## 3. 只打印最终值

如果只想要最终 value，不想要外层 trace wrapper，可以使用 `--quiet`：

```bash
agentscript tutorials/cli.as --mock --quiet --input '{"name":"Rong","request":"Say hello"}'
```

当另一个脚本要消费 JSON 时，这很有用。

## 4. Check 和 Parse

运行前可以先检查程序：

```bash
agentscript tutorials/cli.as --check
```

也可以查看解析后的 AST：

```bash
agentscript tutorials/cli.as --parse
```

大多数时候你会更常用 `--check`。`--parse` 主要用于调试语法或工具链。

## 5. 用 Dry Run 检查 Prompt

`--dry-run` 会构造 prompt 和输出形状，但不调用模型：

```bash
agentscript tutorials/cli.as --dry-run --trace --input '{"name":"Rong","request":"Say hello"}'
```

当你想检查哪些 context 会发送给模型时，用它很合适。

## 6. Trace 和 Trace File

打印可读 trace：

```bash
agentscript tutorials/cli.as --mock --trace --input '{"name":"Rong","request":"Say hello"}'
```

把原始 trace 写入文件：

```bash
agentscript tutorials/cli.as --mock --trace-file /tmp/agentscript-trace.json --input '{"name":"Rong","request":"Say hello"}'
```

trace 是调试 context boundary 的最好工具之一。它会显示每次 `generate` 能看到哪些 `use`。

## 7. 使用输入文件

输入较大时，可以把 JSON 写入文件：

```json
{
  "name": "Rong",
  "request": "Say hello"
}
```

然后运行：

```bash
agentscript tutorials/cli.as --mock --input-file input.json
```

## 8. 启动 REPL

不传文件直接启动 AgentScript：

```bash
agentscript
```

在 REPL 中加载文件：

```text
:load tutorials/repl.as
```

检查：

```text
:check
```

运行：

```text
:run {}
```

退出：

```text
:exit
```

当你想快速草拟一个小 agent，或不想频繁切换文件来检查语法时，REPL 很方便。

## 9. 推荐工作流

开发一个新 agent 时：

1. 编写或加载 `.as` 文件。
2. 运行 `--check`。
3. 用 `--mock` 运行。
4. 用 `--trace` 或 `--dry-run --trace` 检查。
5. 确认形状没问题后，再切换到真实模型。
