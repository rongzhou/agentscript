# npm 和 node tools

本文档定义 AgentScript 程序如何通过 `npm:` 和 `node:` tool URI scheme 调用 npm 包和 Node 内置模块。

Tool import 的整体说明见 [语言参考](./language.md)。Prompt context 选择见 [`use ... as ...`](./use-as.md)。Generation site 见 [`generate`](./generate.md)。

## 目的

AgentScript 程序常常需要在 LLM 调用前后做普通的 scripting 工作：解析 YAML、读文件、计算 hash、按标题拆 Markdown。`.as` 语言本身不实现这些；它们已经以成熟 JavaScript 库的形式存在。

`npm:` 和 `node:` 让 AgentScript 程序直接复用这套生态，而不必在外部写 TypeScript 胶水。

```agentscript
import tool Path from "node:path"
import tool Fs from "node:fs/promises"
import tool Yaml from "npm:yaml"
```

AgentScript 仍然专注于 prompt context。普通数据处理交给包本身。

## 适用范围

`npm:` 和 `node:` 面向 JSON-in / JSON-out 的库。它们不是通用 FFI。

支持：

```text
接受 JSON-safe 值、返回 JSON-safe 值的函数
返回 Promise of JSON-safe value 的 async 函数
值为 JSON-safe 的 named export
通过 Node module loader 解析的 CJS / ESM 包
```

不支持：

```text
返回 class 实例再链式调用的 builder 模式
返回 Date / URL / Buffer / Stream / TypedArray / Map / Set 的 API
callback 风格的 API
必须 new Tool.Cls(...) 的 API
把 npm 函数当 AgentScript 值传递
只能在浏览器 / Deno / Bun 运行的包
未编译为 JavaScript 的 TypeScript source
```

当一个包的公共 API 本身是 JSON 形状的，通常就能直接用。其它情况下，在宿主项目里写一个薄 npm 包，重新导出 JSON-friendly 的 API，再从 AgentScript 导入这个 wrapper。

## URI 形式

### `node:` scheme

```agentscript
import tool Path from "node:path"
import tool FsPromises from "node:fs/promises"
import tool Crypto from "node:crypto"
import tool Url from "node:url"
```

规则：

```text
node:<module> 与 Node 的 URL-style import 语法一致
不编码版本；内置模块随 Node 发布
允许 sub-path，如 node:fs/promises
模块必须在 agentscript.npm.json 中显式列出
```

### `npm:` scheme

```agentscript
import tool Yaml from "npm:yaml"
import tool Marked from "npm:marked"
import tool Scoped from "npm:@acme/util"
import tool Sub from "npm:some-pkg/sub/path"
```

规则：

```text
npm:<package> 从 workspace 的 node_modules 解析
scope 包写作 npm:@scope/pkg
sub-path 写作 npm:pkg/sub
包必须由宿主项目 npm install
AgentScript 从不自己安装包
包（及任何 sub-path）必须在 agentscript.npm.json 中列出
```

AgentScript 中 import 的名字遵循普通 `import tool` 规则，只是 identifier。它不必和包名相同。

## Registry

Workspace 根目录下的 `agentscript.npm.json` 声明允许哪些 `npm:` 和 `node:` import。没有这个文件时，所有 `npm:` 和 `node:` import 在 check 和运行时都会被拒绝。

```json
{
  "allow": {
    "node": ["path", "fs/promises", "crypto", "url"],
    "npm": {
      "yaml": { "version": "^2.3" },
      "marked": { "version": "^12.0" },
      "@acme/util": { "version": "^1.0", "exports": ["json-schema"] }
    }
  }
}
```

字段：

```text
allow.node
  字符串数组
  每项是 Node 内置模块名，不带 node: 前缀
  允许 sub-path，如 "fs/promises"

allow.npm
  以包名为 key 的 object
  version   可选，semver range；按已安装的 package.json 校验
  exports   可选，允许的 sub-path 列表；默认只允许裸包
  effectful 可选，为未来 package 粒度 opt-out 保留；默认 true
```

语义：

```text
默认拒绝：未列出的项一律拒绝
"@acme/util" 这类 scope 包必须带 @ 前缀列出
subPath 必须在 exports 里声明；未列出的 subPath 被拒绝
version 在运行时根据已安装的 package.json 校验
```

Registry 里不出现命令、路径或 secret。和 `agentscript.mcp.json` 一样，它是一份可审计的 capability 列表，不是运行时配置。

## 推荐语法

Tool 调用使用 positional 参数，与底层 JavaScript 函数的调用方式一致：

```agentscript
joined = Path.join("a", "b", "c")
content = Fs.readFile("README.md", "utf8")
doc = Yaml.parse(content)
```

属性读取取 JSON-safe 的 named export：

```agentscript
separator = Path.sep
```

动态 method 名走 `call`：

```agentscript
parsed = Yaml.call({
    method: "parse",
    args: [content]
})
```

四种形式集中展示：

```agentscript
// positional 调用
result = Tool.method(arg1, arg2)

// 属性读取
value = Tool.constant

// async 调用（自动 await Promise）
content = Fs.readFile("README.md", "utf8")

// 动态 method 名
result = Tool.call({
    method: "stringSplit",
    args: ["text", "."]
})
```

## 调用语义

对：

```agentscript
doc = Yaml.parse(text)
```

AgentScript 按如下方式执行：

```text
1. 通过 registry 解析 URI npm:yaml。
2. 每次运行内动态 import 模块一次并缓存。
3. 查找 method "parse"：
   - 优先 mod.parse
   - 其次 mod.default?.parse（兼容 CJS / default export）
4. 将每个参数 marshal 为 JSON-safe 值。
5. 拒绝任何 AgentScript binding 参数（tool、llm、agent、memory、function）。
6. 以 positional 形式调用函数。
7. 如果返回 Promise，自动 await。
8. 将返回值 marshal 回 RuntimeValue；拒绝非 JSON-safe 的值。
```

规则：

```text
参数个数不限
参数必须 JSON-safe
Promise 返回自动 await
无参数的非函数成员按属性读取处理
有参数的非函数成员会报错
```

### `call` 形式

```agentscript
result = Tool.call({
    method: "someName",
    args: [a, b, c]
})
```

规则：

```text
method 必须是非空 string
args 必须是 list
args 是 positional，不是 keyword
call 是保留 method；不会匹配名为 "call" 的模块 export
```

### 属性读取

```agentscript
sep = Path.sep
```

规则：

```text
只能读 JSON-safe 值
函数、class、symbol 不能通过属性读取
可调用成员用 Tool.method(...) 形式
```

## 参数与返回值的 marshal

参数和返回值必须是 JSON 形状：

```text
允许：null、string、number、boolean、数组、plain object
拒绝：
  undefined
  函数
  Symbol
  BigInt
  class 实例（Date、URL、Buffer、Stream、TypedArray、Map、Set、...）
  循环引用
```

被拒绝时抛出带路径的错误：

```text
Npm tool 'Yaml.parse' returned invalid value at result.items[3].created_at: class instance not JSON-safe
Npm tool 'Yaml.parse' expects JSON-safe argument at position 0, got function
Node tool 'Path.join' received AgentScript resource binding at args[1]
```

当包的自然返回形状不是 JSON-safe 时，包一层：

```agentscript
// 不要直接用 Date：
// createdAt = Pkg.now()          // 拒绝：Date 实例

// 改为取序列化后的形式：
createdAtIso = Pkg.nowIso()
```

或者在宿主项目里加一个薄 npm wrapper，重新导出 JSON 形状的 API。

## Async 与自动 await

AgentScript 的每个表达式都在 async runtime 中求值。返回 Promise 的函数会被自动 await：

```agentscript
content = Fs.readFile("README.md", "utf8")
use content max 8k as "file content"
```

没有显式 `await` 关键字。如果返回的 Promise 被 reject，错误会翻译成 AgentScript runtime error，带上 tool、method 和原始 message。

## 副作用与 `parallel for`

npm 和 node tool 默认视为 effectful。它们在 `parallel for` body 中被拒绝，与 `sh://`、`mcp://`、`http://` 的 effectful method 一致。

被拒绝：

```agentscript
results = parallel for file in files max 20 {
    Fs.readFile(file.path, "utf8")
}
```

Diagnostic：

```text
effectful tool 'Fs.readFile' is not allowed inside parallel for
```

把读操作移到外面：

```agentscript
contents = []

for file in files max 20 {
    contents.add(Fs.readFile(file.path, "utf8"))
}

summaries = parallel for content in contents max 20 {
    SummarizeChunk(content)
}
```

即便某个具体函数是只读的，首版 AgentScript 也不在 method 级别上区分。这是保守选择；更细粒度的 opt-in 将来可以通过 registry 的 `effectful` 字段提供。

## Capability 规则

三道独立的闸门保护 workspace：

```text
1. Registry 白名单：只有列出的 node: / npm: 目标才可 import。
2. 显式 import：每个 .as 文件仍需按名字 import。
3. Prompt 边界：返回值不会隐式进入 prompt；
   仍需 use ... as ... 。
```

没有用来跳过 registry 的 CLI 选项。缺 `agentscript.npm.json` 即表示不允许 npm 或 node import。

高风险的 Node 模块（`node:child_process`、`node:vm`、`node:worker_threads`、同步版 `node:fs` 等）可以加入白名单，但取舍由宿主负责。优先选择能完成任务的最安全模块。

## `--check`

`agentscript --check` 保持静态、离线：

```text
如果存在就读 agentscript.npm.json
按 registry 校验每个 npm: / node: import
不做模块的动态 import
不校验已安装版本
不校验 method 是否存在
```

仅运行时做的校验：

```text
真实动态 import 并解析模块
按已安装 package.json 校验 version
method 是否存在
参数和返回值 marshal
```

这让 `--check` 能在没有 `node_modules` 的 CI 环境里运行。

## `--dry-run`

`agentscript --dry-run` 不执行任何 npm / node tool call。Registry 白名单仍然生效；调用本身返回 `null`。后续 `generate` 继续走 dry-run LLM provider。

## Trace

npm 和 node tool call 沿用现有 `tool` trace kind。`scheme` 字段被设为 `npm` 或 `node`：

```json
{
  "kind": "tool",
  "data": {
    "tool": "Yaml",
    "method": "parse",
    "scheme": "npm",
    "uri": "npm:yaml",
    "args": ["title: Hello\ntags: [ai]"],
    "result": { "title": "Hello", "tags": ["ai"] },
    "effects": null
  }
}
```

Trace 不包含模块物理路径、registry 内容或 stack trace。

## 示例：YAML front matter

```agentscript
import tool Fs from "node:fs/promises"
import tool Yaml from "npm:yaml"
import llm Fast from "ollama://localhost:11434/qwen3.6"

main agent FrontMatterSummarizer {
    model Fast
    role "Technical Writer"
    description "Summarize a Markdown file with YAML front matter."

    main func(input { path string }) {
        content = Fs.readFile(input.path, "utf8")

        parts = Yaml.parseAllDocuments(content)
        front = parts[0]

        use input.path as "source path"
        use front as "front matter"
        use content max 8k as "file content"

        generate({
            input: "Write a short summary and surface the metadata."
        }) -> {
            title
            summary
            tags list[string]
        }
    }
}
```

Registry：

```json
{
  "allow": {
    "node": ["fs/promises"],
    "npm": {
      "yaml": { "version": "^2.3" }
    }
  }
}
```

## 示例：Markdown 预处理

```agentscript
import tool Fs from "node:fs/promises"
import tool Marked from "npm:marked"

main agent SectionSummarizer {
    model Fast
    role "Editor"
    description "Summarize one section of a Markdown file."

    main func(input { path string, heading string }) {
        content = Fs.readFile(input.path, "utf8")
        tokens = Marked.lexer(content)

        section = find_section(tokens, input.heading)

        use section max 4k as "target section"

        generate({
            input: "Summarize the target section."
        }) -> {
            summary
            key_points list[string]
        }
    }

    func find_section(tokens, heading) {
        // 使用 AgentScript 的 list / object 能力的辅助函数示意；
        // 真实实现会遍历 tokens，收集匹配 heading 下的块。
        tokens
    }
}
```

## 示例：node crypto 生成标识

```agentscript
import tool Crypto from "node:crypto"

main agent RunRecorder {
    model Fast
    role "Run Recorder"
    description "Produce a stable run identifier for downstream storage."

    main func(input { label string }) {
        run_id = Crypto.randomUUID()

        use input.label as "label"
        use run_id as "run id"

        generate({ input: "Compose a short run manifest." }) -> {
            run_id
            title
            note
        }
    }
}
```

Registry：

```json
{
  "allow": {
    "node": ["crypto"],
    "npm": {}
  }
}
```

## 常见错误

```text
Package 'yaml' is not allowed by agentscript.npm.json
  → 在 agentscript.npm.json 的 allow.npm 中加入 "yaml"

Node module 'fs' is not allowed by agentscript.npm.json
  → 在 allow.node 中加入 "fs"（或 "fs/promises"）

Failed to import 'yaml'. Possible causes:
not npm installed? workspace root incorrect?
  → 在 workspace 运行 npm install yaml

Package 'yaml' installed version '1.10.0' does not satisfy '^2.3' in agentscript.npm.json
  → 升级已安装的包，或放宽 registry 里的 range

Unknown method 'Yaml.toYaml'
  → 核对包的 API；正确名字可能是 'stringify'

Npm tool 'Yaml.parse' returned invalid value at result.extra: class instance not JSON-safe
  → 包一层，或者换一个返回 plain object 的函数

effectful tool 'Fs.readFile' is not allowed inside parallel for
  → 把调用移到 parallel for 前；把读到的数据作为 list 传入
```

## 与其它 tool scheme 的对比

```text
node:  进程内，Node 内置，免安装，开销低
npm:   进程内，宿主已安装包，开销低，仅限 JSON-in / JSON-out
mcp:   进程外 stdio server，JSON-RPC，易沙箱，延迟较高
sh:    进程外命令执行，严格白名单
file:  内置文件操作，带 workspace 边界
http/https: 外部 HTTP endpoint，带 origin 限制
```

按任务选择 scheme。对于纯 JavaScript 工具，`npm:` 通常是最短路径。

## 设计检查清单

修改 `npm:` 或 `node:` 前，应检查：

```text
每次 import 都仍然需要 agentscript.npm.json 中的一个条目吗？
AgentScript 是否仍然拒绝自行安装包？
参数和返回值是否仍然限定在 JSON-safe？
npm 和 node tool 是否在 parallel for 中仍视为 effectful？
--check 是否仍然静态、离线？
--dry-run 是否仍然跳过真实模块调用？
trace 是否仍然不暴露模块路径和 stack trace？
错误是否仍然带上 tool、method 和路径信息？
```

## 摘要

```text
node: 调用 Node 内置模块。
npm:  调用宿主项目已安装的 npm 包。

两者都受 agentscript.npm.json 管理。
两者都使用 positional 参数和 JSON-safe marshal。
两者都是 effectful，在 parallel for 中被拒绝。
两者都不安装任何东西；两者都不改变 prompt 边界。
```

Canonical 示例：

```agentscript
import tool Fs from "node:fs/promises"
import tool Yaml from "npm:yaml"

main agent Example {
    main func(input { path string }) {
        content = Fs.readFile(input.path, "utf8")
        meta = Yaml.parse(content)

        use meta as "file metadata"

        generate({ input: "Describe the file." }) -> {
            title
            summary
        }
    }
}
```
