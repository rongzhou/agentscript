# AgentScript V4 Design

V4 的目标是让 AgentScript `.as` 程序能直接调用宿主项目里的 npm 包与 Node 内置模块。这让 AgentScript 从"LLM context DSL"升级为"带 LLM 能力的轻量 scripting 环境"，可以复用整个 npm 生态，而无需宿主写 TypeScript 胶水代码。

V4 Phase 1 聚焦两个 URI scheme：`npm://` 和 `node://`。其它宿主互操作形式（嵌入式 API、host function registry 等）留给后续版本。

## 设计定位

V4 不是一个通用 FFI。它仍然服从 AgentScript 的核心哲学：

- 显式 capability：只有被 `import` 且被 registry 授权的 npm 包或 node 内置模块才能被调用。
- 显式 prompt context：npm 调用的返回值是普通数据，只有被 `use` 才进入 prompt。
- JSON 世界：AgentScript 的运行时值是 JSON-oriented。npm API 无法完整适配 JSON 语义的部分（class 实例、stream、function-returning-function 的 builder 等）不在 V4 支持范围内。
- 小而可审计：AgentScript 永远不会 `npm install` 任何包。包由宿主项目负责安装；AgentScript 只负责解析、调用、marshal、审计。

这和"大而全"的 FFI 不同：V4 刻意放弃对 npm 生态所有 API 的通用支持。代价是一部分包不能直接用；收益是 `.as` 文件保持可读、可审计、可重现。

## 目标

V4 Phase 1 支持：

- `import tool X from "npm:package"` 调用已安装的 npm 包。
- `import tool X from "node:module"` 调用 Node 内置模块（`node:path`、`node:fs/promises`、`node:crypto` 等）。
- `X.method(a, b, ...)` 使用 positional 参数，映射为模块上对应的函数调用。
- `X.property` 读取模块导出的 JSON-safe 标量或对象。
- `X.call({ method, args })` 作为动态 method 名的通用入口。
- 同步返回值、Promise、JSON-safe object/array 自动 marshal。
- npm tool 默认视为 effectful，`parallel for` body 中禁止调用（与 `mcp://`、`sh://` 一致）。
- 通过 `agentscript.npm.json` registry 明确允许的 npm 包和 node 模块。
- `--check` 对未授权的 `npm:` / `node:` import 报错；不 probe 真实模块。
- 保持 zero runtime dependency：AgentScript 本身不依赖任何 npm 包；被调用的包是宿主项目的依赖。

V4 Phase 1 不支持：

- 自动 `npm install`。
- 返回 class 实例后再链式调用的 API（builder pattern）。
- 把 npm 函数当一等公民值存入 `.as` 变量再传递。
- Callback-based API（只支持 sync 返回或 Promise）。
- Stream / Buffer / TypedArray 原样进入 `.as`；需要宿主自己 shim 成 JSON。
- 全局副作用型包（Express、React 等 runtime framework）。
- TypeScript source 直接 `import` 到 `.as`；npm 包必须已编译为 JS。
- 在浏览器 / Deno / Bun 运行；保持 Node `>=22.13` 的既有 engines 要求。
- 在 `.as` 里声明 npm 包版本（版本在 registry / `package.json` 中管理）。

## 与语言的关系

语法不变。`import` 的 `tool` kind 已经能承载任意 URI：

```agentscript
import tool Path from "node:path"
import tool Fs from "node:fs/promises"
import tool Yaml from "npm:yaml"
import tool Marked from "npm:marked"

main agent Summarizer {
    main func(input { path: string }) {
        content = Fs.readFile(input.path, "utf8")
        front = Yaml.parse(Marked.lexer(content)[0].text)

        use content max 8k as "source file"
        use front as "front matter"

        generate({ input: "Summarize with metadata" }) -> {
            title
            summary
            tags: list[string]
        }
    }
}
```

关键点：

- `Fs.readFile(...)` 返回 Promise，runtime 自动 await。
- `Yaml.parse(...)` 返回 plain object，直接作为 `RuntimeValue`。
- `Marked.lexer(...)[0].text` 使用 AgentScript 的 `IndexExpr` 和 `MemberExpr`，前提是返回的数据 JSON-safe。
- 所有这些调用的结果都必须被 `use` 才能进入 prompt；AgentScript 的 context boundary 不变。

## URI 语义

### `node:` scheme

```agentscript
import tool Path from "node:path"
import tool FsPromises from "node:fs/promises"
import tool Crypto from "node:crypto"
```

规则：

- `node:<module>` 与 Node 内置模块的 URL-style import 形式一致。
- 不需要版本字段（内置模块随 Node 发布）。
- runtime 用动态 `import("node:<module>")` 加载。
- 只允许 registry 中 `allow` 列出的 node 模块。默认空列表，显式 opt-in。
- `node:child_process`、`node:vm`、`node:worker_threads` 等高风险模块默认不在推荐白名单里；宿主可以授权，但文档会强调风险。

### `npm:` scheme

```agentscript
import tool Yaml from "npm:yaml"
import tool Zod from "npm:zod"
```

规则：

- `npm:<package>` 指向宿主 `node_modules` 中已安装的包。
- 不在 URI 中编码版本；版本由宿主 `package.json` 决定，registry 可以再记录一次。
- runtime 用动态 `import("<package>")` 加载；`<package>` 是 URI 去掉 `npm:` 前缀后的部分。
- scoped package 形式：`npm:@scope/pkg` 合法；URL 解析把 `@scope/pkg` 作为 path 处理。
- sub-path import：V4 Phase 1 允许 `npm:pkg/sub/path`（即 `npm:react-markdown/lib/ast-to-react` 这类），但必须整条路径在 registry 中允许。
- 只允许 registry 中 `packages` 声明的包被导入。

### 为什么两个 scheme 分开

`node:` 内置模块天然属于 Node runtime 的一部分，不需要安装步骤，边界非常明确。

`npm:` 则涉及第三方代码、版本管理、供应链安全。分开 scheme 能让 registry 用不同的校验规则（比如 `npm:` 必须声明版本约束，`node:` 不需要），也让未来 `bun:`、`deno:` 这类扩展留有空间而互不冲突。

## Registry 配置

registry 文件：`agentscript.npm.json`，位于 workspace root。格式：

```json
{
  "allow": {
    "node": ["path", "fs/promises", "crypto", "url"],
    "npm": {
      "yaml": { "version": "^2.3" },
      "marked": { "version": "^12.0" },
      "@scope/util": { "version": "^1.0" }
    }
  }
}
```

规则：

- 没有这个文件时，任何 `npm:` 或 `node:` import 在 `--check` 与运行时都会被拒绝。
- `allow.node` 是字符串数组；字符串必须是 Node 内置模块的裸名（不带 `node:` 前缀）。
- `allow.npm` 是 map，key 是包名，value 是 object 可以包含：
  - `version`（可选）：semver 约束；运行时用宿主 `package.json` / `node_modules/<pkg>/package.json` 的 version 字段校验。
  - `exports`（可选）：允许的 sub-path 列表，默认只允许 bare `"."`。形式 `["json-schema"]` 表示允许 `npm:pkg/json-schema`。
  - `effectful`（可选）：默认 `true`。若宿主确认某包的指定 method 纯函数且无副作用，可设为 `false` 或给到更细 method 级别；Phase 1 可先只支持 package 级别 flag，method 级由后续版本做。
- registry 中所有 key 都是 `.as` import 时 URI 去掉 scheme 后的字符串严格匹配。
- registry 不自动发现 `node_modules`；每个包都必须显式列出。这是 capability 显式原则的体现。

registry 文件缺失或 malformed 时，runtime 报明确错误（消息含路径和字段）。

## 调用语义

### 成员调用

AgentScript 中：

```agentscript
text = Yaml.stringify({ a: 1, b: [2, 3] })
doc = Yaml.parse(text)
```

映射：

```ts
const mod = await import("yaml");
const text = await mod.stringify({ a: 1, b: [2, 3] });
const doc = await mod.parse(text);
```

规则：

- 从 ESM 动态 import；Node 会自动处理 CJS interop。
- 优先使用 `mod.<method>`；若 `<method>` 不在命名导出里但 `mod.default?.<method>` 存在，则走 default 导出。这覆盖多数 CJS + ESM 互操作情况。
- method 必须是 function；不是则报 `Unknown method '<tool>.<method>'`。
- 参数为 positional，按出现顺序传递；参数数量任意。
- 每个参数必须是 JSON-safe runtime value；binding 值（tool、llm、agent 等）作为参数被拒绝。
- 如果函数返回 Promise，runtime 自动 await。
- 返回值必须是 JSON-safe；否则报 marshal 错误（与 V5 设计里 host value marshal 规则一致）。

### 属性读取

```agentscript
sep = Path.sep
```

规则：

- 只允许读 JSON-safe 的 primitive / array / plain object。
- 函数、class、Symbol 等不可读；需要改用 `Tool.method(...)` 调用形式。
- 读属性不走动态 import 的 default 回落；只读命名导出。
- 大多数情况下 registry 里包的作者已经把"常量"当命名导出发布，这条规则足够用。

### `call` 动态入口

```agentscript
result = Yaml.call({
    method: "parse",
    args: [text]
})
```

映射：

```ts
await mod.parse(text);
```

规则：

- `call` 保留方法名；`args` 必须是 list；`method` 必须是字符串。
- 用途：method 名在 AgentScript 中不是合法 identifier（极少见于 npm，但 `node:fs` 里有 `fs/promises`、其它可能有 `$` 之类）。
- `call` 不改变参数语义；仍是 positional。

### `new` 与 class

V4 Phase 1 不支持 `new Tool.Something(...)`。

如果包的 API 必须通过 class 才能用（例：`new Date(...)`、`new URL(...)`），要求宿主先在 `.as` 之外 shim 成函数式 API，或者等后续版本评估是否加 `Tool.new(...)` 入口。Phase 1 保持严格，避免把 class 实例带入 AgentScript runtime value 体系。

`Date` 和 `URL` 特例：作为 npm 调用的返回值出现时，runtime 视作 non-JSON 对象并拒绝。推荐的用法是让调用侧先 `.toISOString()` / `.href` 或其它序列化方法。这条规则简单粗暴，代价是开发者需要在 `.as` 侧写额外包装，收益是 marshal 规则只有一条"JSON-safe or fail"。

## 值 Marshal

沿用 V5 设计中的 marshal 规则（`src/runtime/host-marshal.ts`，见 V5 实施文档）：

- AgentScript → npm：参数拷贝为 JSON-safe 值；任何 binding 值出现被拒绝。
- npm → AgentScript：返回值必须是 `null`、string、number、boolean、array、plain object 的组合；`undefined` / 函数 / Symbol / BigInt / class 实例 / 循环引用 / Map / Set / Buffer / Stream 全部拒绝。

一条 shared rule：这个 marshal 模块由 V4 与 V5 共用，不在两个版本间重复实现。V4 率先实现 marshal，V5 复用。

错误消息要求：

- `Npm tool '<tool>.<method>' returned invalid value at <path>: <reason>`。
- `Node tool '<tool>.<method>' returned invalid value at <path>: <reason>`。
- `Npm tool '<tool>.<method>' expects JSON-safe argument at position <i>, got <type>`。
- `Package '<pkg>' is not allowed by agentscript.npm.json`。
- `Node module '<module>' is not allowed by agentscript.npm.json`。
- `Package '<pkg>' installed version '<v>' does not satisfy '<range>' in agentscript.npm.json`。

## 加载与缓存

实现细节：

- 第一次调用某个 `npm:pkg` / `node:mod` 时动态 `import()`；结果 module namespace 对象缓存到 runtime scope。
- 同一次 `executeAgent` 调用内，同一模块只加载一次。
- 不跨 run 缓存；REPL 模式下按每次 run 缓存，以便开发时更改 node_modules 能重新生效（更严格的缓存策略留给后续）。
- ESM dynamic import 是 Node 内置能力；runtime 没有额外 dep。

解析规则：

- `npm:<pkg>` 解析为 `import("<pkg>")`，以 workspace root 为 cwd。
- `node:<mod>` 解析为 `import("node:<mod>")`。
- `npm:<pkg>/<sub>` 解析为 `import("<pkg>/<sub>")`。
- 解析失败时抛 `RuntimeError`，消息含"可能原因：未 npm install？workspace root 是否正确？"。

## capability 与安全

V4 的安全模型建立在三个独立机制上：

1. **Registry 白名单**：只有 `agentscript.npm.json` 里列出的 `node:` 模块和 `npm:` 包能被 import。默认什么都不给。
2. **显式 import**：即使 registry 授权了，也要 `.as` 文件里显式 `import tool ...`，才能在该文件里调用。
3. **prompt boundary**：npm 返回值不自动进 prompt；需要 `use`。

高风险模块约定：

- `node:child_process`、`node:vm`、`node:worker_threads`、`node:fs`（同步版本）、`npm:execa` 等可以被 registry 授权，但文档明确提醒。
- 不引入像 `--allow-npm-all` 的通配开关；保持"每个包都要显式列出"。
- secrets：registry 本身不承载任何 secret；npm 包自己通过环境变量或 registry 未覆盖的机制读取。

这个模型与 `mcp://` 的 registry 模型在精神上一致：把"能做什么"从 `.as` 代码里剥离到本地配置。

## 并发与 parallel-for

- `npm:` 和 `node:` tool 的 member call 默认视为 effectful。
- semantic 阶段在 `parallel for` body 内拒绝 `npm:` / `node:` 成员调用，复用现有 effectful scheme 列表。
- registry 中的 `effectful: false` 是预留字段；Phase 1 semantic 不消费这个字段，保持保守。
- 即便未来放开 `effectful: false`，仍要求 registry 显式标注，而不是默认允许。

## Trace

沿用现有 `tool` trace kind：

```json
{
  "kind": "tool",
  "data": {
    "tool": "Yaml",
    "method": "parse",
    "scheme": "npm",
    "uri": "npm:yaml",
    "args": ["..."],
    "result": { "title": "..." },
    "effects": null
  }
}
```

对 `node:` 也一样，`scheme` 为 `node`。

trace 不记录 module 的物理路径；不记录 registry 文件内容。错误 message 进入 trace，stack 不进入 trace。

## `--check`

`--check` 必须保持静态、快速、可离线。V4 的静态检查：

- 读取 `agentscript.npm.json`（如果不存在，所有 `npm:` / `node:` import 都报错）。
- `import tool X from "npm:pkg"`：检查 `pkg` 在 `allow.npm` 中。
- `import tool X from "node:mod"`：检查 `mod` 在 `allow.node` 中。
- 不 `import()` 真实模块；不检查 version；不检查 method 是否存在。

运行时校验才会做：

- 真实 `import()` 解析。
- version 校验（对比 registry 声明和 `node_modules/<pkg>/package.json`）。
- method 存在性。
- marshal。

这样 `--check` 可以在 CI 中离线运行，同时保留运行时的完整 capability 校验。

## `--dry-run`

`--dry-run` 不调用 npm/node 模块的任何 method。行为：

- `import tool X from "npm:..."` 仍被 capability 校验（registry 白名单）。
- 调用 `X.method(...)` 直接返回 `null`，以保证后续 `.as` 流程能继续跑到 `generate`。
- 属性读取 `X.prop` 返回 `null`。
- trace 中标注 `dryRun: true`（本字段由 Phase 1 新增，只在 dry-run 下出现）。

这与现有 `DryRunLlmProvider` 语义一致：dry-run 永远不做外部副作用。

## 与 MCP 的关系

两者都在"扩展 `.as` 能做什么"：

- `mcp://` 走 stdio 子进程，协议是 JSON-RPC，零 dep，但每次 call 都要跨进程。
- `npm:` / `node:` 走进程内动态 import，零 dep（在 AgentScript 这边），call 开销低，但只能调用 JSON-friendly API。

两者不冲突。典型选择：

- 原生 Node 能力（path、fs、crypto）：`node:`。
- 进程内纯 JS 工具（yaml、marked、cheerio 的部分 API）：`npm:`。
- 跨语言 / 跨进程 / 需沙箱的工具（搜索引擎、代码库扫描器、黑盒服务）：`mcp://`。

## 与 V5（host 嵌入）的关系

V5 聚焦 TypeScript 嵌入 AgentScript runtime、向 `.as` 注入 `host://` tool/llm/memory。两者正交：

- V4：`.as` 主动拉 npm 包。
- V5：外部 TS 程序把 AgentScript 作为一个小 runtime 使用。

共享基础：

- marshal 工具（Phase 1 由 V4 实现，V5 复用）。
- effectful scheme 列表在 semantic 层的分类规则。
- trace kind 不新增。

版本关系：

- 开发次序：V4 在 V5 之前。V4 的使用场景（`.as` 脚本化 + 少量 LLM 决策）更高频，优先落地。
- V5 可以和 V4 独立演进；都不破坏既有 `.as` 程序。

## 设计不变式

V4 Phase 1 完成后仍必须成立：

- `use` 是唯一让数据进入 prompt 的方式。
- `generate` 是唯一 LLM call site。
- scope 控制 context 可见性。
- capability 显式：npm/node 能力由本地 registry 授予，不由 `.as` 源码暗中生效。
- trace 覆盖所有 npm/node 调用。
- npm/node 异常不会静默；总是翻译为 AgentScript runtime 错误。
- AgentScript runtime 不依赖任何 npm package（被调用的 npm 包是宿主项目的依赖，不是 AgentScript 的依赖）。

## 非目标

V4 Phase 1 明确不做：

- 支持返回 class 实例后再链式调用的 npm API（zod schema、prisma client、工厂返回的构造器）。
- 自动把 Buffer/Stream/Date/URL 转成 JSON；宿主在 registry 之外的 shim 包装是用户代码职责。
- 支持 `new Tool.Cls(...)`。
- 支持把 npm 函数赋给 `.as` 变量再传来传去。
- 提供 `agentscript install`；AgentScript 不 fork npm。
- 浏览器 / Deno / Bun 运行。
- 通过 URL 直接 import 未安装的包（`npm:` 必须对应已安装的包）。
- 把 TypeScript source `.ts` 直接喂给 AgentScript；要求运行时是编译后的 JS。

## 开放问题

Phase 1 需要先拍板：

- registry 文件名固定为 `agentscript.npm.json` 还是合并到一个更大的 `agentscript.config.json`？**推荐：先独立 `agentscript.npm.json`，与 `agentscript.mcp.json` 风格一致。未来再考虑合并。**
- 是否允许 `npm:pkg` 省略 `package.json` 版本校验？**推荐：默认跳过 version 校验（registry 里不写 version 就不校验），显式写了就严格校验。这样初上手可以只写 `allow.npm: { "yaml": {} }`。**
- 是否提供一个 opinionated 白名单（`node:path`、`node:fs/promises` 等）作为内置默认？**推荐：否。所有授权都在 user registry 里，AgentScript 不内置任何默认白名单。一致性优先于便利。**
- method 级别 `effectful: false` 是否在 Phase 1 落地？**推荐：否；Phase 1 只支持 package 级别默认 effectful=true，semantic 在 parallel-for body 内统一拒绝。method 级别精细化留给 V4.1。**
- 是否允许 CLI `--allow-npm pkg1,pkg2` 临时授权？**推荐：否；保持 registry 单一入口，避免 CLI 授权路径被脚本偷偷使用。**
- `Tool.call({ method, args })` 的 `args` 是 positional list 还是 single object？**推荐：list（positional），因为 npm API 是 positional 的；这点与 MCP 的 `call({ tool, args })`（args 是 object）不同，但因为是不同 scheme，不会混淆。**

## 示例清单

设计完成后，实施阶段会补上这些 `.as` 示例：

- `examples/npm-yaml.as`：`node:fs/promises` + `npm:yaml`，解析 front matter。
- `examples/npm-marked.as`：`npm:marked`，把 Markdown 转成 AST，用于 LLM summarization 输入。
- `examples/node-crypto.as`：`node:crypto`，用 hash/random 组织 id，展示纯 node 能力。

每个示例对应 registry 最小配置片段。这些示例会和已有 `examples/` 风格保持一致：一个文件说明一件事。
