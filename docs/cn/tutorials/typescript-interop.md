# TypeScript 与 Node 互操作

AgentScript 的重点是描述 agent workflow 和模型上下文，而不是替代 JavaScript /
TypeScript 生态。遇到普通编程任务时，可以通过 `import tool` 调用显式授权的
Node 内置模块，或宿主项目里已经安装的 npm 包。

这篇教程使用 Node 内置模块，因此在当前仓库里不需要额外安装依赖就能运行。

完整源码：[`../../../tutorials/typescript-interop.as`](../../../tutorials/typescript-interop.as)

## 1. Capability Registry

`node:` 和 `npm:` import 默认拒绝。workspace 必须通过
`agentscript.npm.json` 显式授权：

```json
{
  "allow": {
    "node": ["crypto"],
    "npm": {}
  }
}
```

这份文件应该保持小而可审计。它表示当前 workspace 允许 AgentScript 程序调用
Node 的 `crypto` 模块，但还没有授权任何 npm 包。

## 2. 程序

创建 `typescript-interop.as`，或者直接打开仓库里的
`tutorials/typescript-interop.as`：

```agentscript
import tool Crypto from "node:crypto"

main agent TypeScriptInterop {
    role "Interop example"
    description "Use a Node built-in module from AgentScript and return JSON-safe data."

    main func(input {
        label: string
        payload: json
    }) {
        run_id = Crypto.randomUUID()
        digest = Crypto.hash("sha256", input.label, "hex")

        return {
            label: input.label,
            payload: input.payload,
            run_id: run_id,
            digest: digest
        }
    }
}
```

这里没有 `generate`。这是刻意的：互操作能力在调用模型之前也有价值。你可以先
做数据标准化、生成 ID、读取文件，或者调用一个 JSON-friendly 的库，然后在后续
agent 中决定哪些结果要通过 `use` 进入模型上下文。

## 3. 运行

```bash
agentscript tutorials/typescript-interop.as --quiet --input '{"label":"release-notes","payload":{"version":"0.1.19","kind":"patch"}}'
```

输出会包含原始 JSON payload，以及 Node 生成的值：

```json
{
  "label": "release-notes",
  "payload": {
    "version": "0.1.19",
    "kind": "patch"
  },
  "run_id": "generated-uuid",
  "digest": "sha256-hex-digest"
}
```

## 4. 这对 TypeScript 意味着什么

AgentScript 不直接执行 TypeScript source file。它通过 Node module loader
调用 JavaScript 模块。实际使用时，可以这样理解：

- `node:crypto` 这类 Node 内置模块在授权后可以直接导入。
- npm 包需要先由宿主项目安装，再写入 `agentscript.npm.json`。
- TypeScript 写的库需要先编译或发布为 JavaScript，之后就能按 npm 包调用。
- 函数参数和返回值必须是 JSON-safe：string、number、boolean、`null`、数组、
  plain object。

如果某个包暴露的是 class、stream、buffer、callback 或 builder object，建议在
TypeScript 侧写一层很薄的 JSON-friendly wrapper，编译成 JavaScript 后再由
AgentScript 导入。

## 5. 调用 npm 包

对于已经安装的 npm 包，写法一样：

```agentscript
import tool Yaml from "npm:yaml"

main agent ParseYaml {
    main func(input {
        text: string
    }) {
        doc = Yaml.parse(input.text)

        return {
            document: doc
        }
    }
}
```

宿主项目需要安装 `yaml` 并授权：

```json
{
  "allow": {
    "node": ["crypto"],
    "npm": {
      "yaml": { "version": "^2.0" }
    }
  }
}
```

## 下一步

完整边界和异常情况见：[`../npm-tools.md`](../npm-tools.md)。然后继续阅读 ReAct
教程，看 tool result 如何进入模型上下文。
