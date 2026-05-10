# AgentScript V4 实施计划

本文档描述 V4 Phase 1 的实施方案。V4 设计见 `v4-design.md`。

V4 Phase 1 的实现目标是让 `.as` 程序能通过 `npm:` / `node:` scheme 调用宿主项目中已安装的 npm 包和 Node 内置模块。它不改变语言语法，不引入 AgentScript 自身的 npm 依赖，不加新关键字。工作集中在：registry 加载、scheme provider、marshal 工具、semantic 的 effectful 列表扩展、trace 与错误细化、文档与示例。

## 原则

- npm/node 互操作是 provider extension，不是语言特性。
- `import tool X from "npm:..."` / `"node:..."` 复用现有 tool import 语义。
- 所有 npm/node 调用的返回值是普通 `RuntimeValue`，不会自动进入 prompt。
- capability 白名单来自 `agentscript.npm.json`；AgentScript 不内置默认白名单。
- 动态 `import()` 只在运行时发生；`--check` 永远静态、离线。
- runtime 错误必须带 tool、method、URI、具体原因。
- zero runtime dependency：AgentScript 不引入任何 npm 依赖。

## 阶段 1：Registry 加载与校验

状态：计划中。

新增模块：

```text
src/providers/tools/npm-registry.ts
```

职责：读取 `agentscript.npm.json`，校验结构，提供 `isNpmPackageAllowed` / `isNodeModuleAllowed` / `findNpmPackageEntry` 等查询接口。

推荐类型：

```ts
export interface NpmRegistry {
  allow: {
    node: Set<string>;
    npm: Map<string, NpmPackageEntry>;
  };
  path: string | null;  // registry 文件绝对路径，无则 null
}

export interface NpmPackageEntry {
  name: string;
  version?: string;     // semver range
  exports?: string[];   // 允许的 sub-path
  effectful?: boolean;  // 默认 true
}
```

实现项：

- 从 workspace root 读取 `agentscript.npm.json`。文件不存在时返回 `{ allow: { node: Set(), npm: Map() }, path: null }`。
- 顶层必须是 object；`allow` 必须是 object；`allow.node` 必须是字符串数组（每条必须是合法 Node 内置模块裸名，允许 `fs/promises` 这种 sub-path）；`allow.npm` 必须是 object，key 是包名，value 是 object（`version`、`exports`、`effectful` 可选，类型须正确）。
- 校验错误一律抛出，消息带 registry 路径和具体 JSON path（例如 `"allow.npm.yaml.version must be string"`）。
- 暴露一个函数判断 import URI 是否被授权：
  - `checkNpmImport(uri, registry)`：对 `npm:<pkg>` / `npm:<pkg>/<sub>` 判断；若允许返回 `{ package, subPath, entry }`；否则抛带原因的 error。
  - `checkNodeImport(uri, registry)`：对 `node:<mod>` 判断。
- 不在这里做 version 校验：version 校验要读 installed `package.json`，属于运行时职责（阶段 3）。

验收：

- 无 registry 时，所有 `npm:` / `node:` 判定被拒。
- 允许 scope 包：`@acme/util` 能通过。
- 允许 sub-path：`npm:pkg/sub` 只有在 `entry.exports` 包含 `sub` 时放行，未列出时拒绝。
- malformed registry 报路径化错误。

## 阶段 2：Marshal 工具（共享 V5）

状态：计划中。

新增模块：

```text
src/runtime/host-marshal.ts
```

职责：V4 与 V5 共享的 JSON marshal 工具。

接口：

```ts
export interface MarshalContext {
  label: string;   // e.g. "npm tool 'Yaml.parse' result"
}

export function toJsonArg(value: RuntimeValue, context: MarshalContext): JsonValue;
export function fromHostValue(value: unknown, context: MarshalContext): RuntimeValue;
export function requireJsonObject(value: unknown, label: string): JsonObject;
```

实现细节：

- `toJsonArg`：深度递归，把 `RuntimeValue` 中的 binding 值（tool/llm/agent/memory/function）标记为 error；返回 JSON-safe 深拷贝。
- `fromHostValue`：递归校验。拒绝 `undefined`、函数、Symbol、BigInt、class 实例（除 plain Object）、循环引用、Map/Set/Buffer/Stream/TypedArray。以 `WeakSet` 跟踪循环。
- `requireJsonObject`：断言值是 plain object（非数组、非 null）。
- 错误消息包含 `path` 字段（`result.items[3].text`）。

验收：

- 纯 JSON 深拷贝来回 roundtrip。
- binding 值作为参数被拒绝。
- `undefined` 字段被拒绝（包括数组里的 `[1, undefined, 3]`）。
- 循环引用被拒绝。
- 错误消息路径准确到字段。

说明：这个模块在 V4 落地后由 V5 直接复用。

## 阶段 3：NodeToolProvider 与 NpmToolProvider

状态：计划中。

新增模块：

```text
src/providers/tools/npm.ts
src/providers/tools/node.ts
```

两者共用一个辅助基类或共用工具集（推荐后者，避免不必要的继承）。

核心逻辑：

```ts
class NpmToolProvider implements ToolProvider {
  constructor(private registry: NpmRegistry, private workspaceRoot: string) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const { package: pkg, subPath, entry } = checkNpmImport(request.uri, this.registry);
    await this.verifyInstalledVersion(pkg, entry);  // 按需
    const mod = await this.loadModule(pkg, subPath);
    return invokeModuleMember(mod, request, {
      schemeLabel: "npm",
      toolLabel: request.toolName,
    });
  }
}
```

实现项：

- `loadModule(pkg, subPath)`：内部缓存 `Map<string, unknown>`；首次调用 `await import(target)`，`target` 为 `pkg` 或 `pkg/<subPath>`；解析失败时抛 `RuntimeError`，提示"可能原因：未 npm install？workspace root 是否正确？"。
- `verifyInstalledVersion(pkg, entry)`：如果 `entry.version` 为 undefined，跳过；否则读取 `<workspaceRoot>/node_modules/<pkg>/package.json` 的 `version` 字段，与 `entry.version` 做 semver-lite 比对。
  - 由于禁止引入依赖，semver 比对用一个极简实现：支持 `^X.Y.Z`、`~X.Y.Z`、`>=X.Y.Z`、`X.Y.Z`、`*`。不覆盖全 semver；超出支持的 range 就直接报 `Unsupported version range`。详细规则放入阶段 1 registry 校验消息。
  - 版本不匹配报 `Package '<pkg>' installed version '<v>' does not satisfy '<range>' in agentscript.npm.json`。
  - 每个 package 只校验一次，缓存结果。
- `invokeModuleMember(mod, request, info)`：
  - 解析 method：优先 `mod[method]`，否则 `mod.default?.[method]`；都不存在报 `Unknown method '<tool>.<method>'`。
  - 参数 marshal：每个 arg 走 `toJsonArg`；若 request.args 中任意 arg 有 binding 直接报错。
  - 如果目标是 function：调用 `fn(...args)`；若返回 Promise 则 await。
  - 如果目标不是 function 且 args 非空：报 `'<tool>.<method>' is not a function`。
  - 如果目标不是 function 且 args 为空：当作属性读取，走 `fromHostValue`。
  - 把最终返回值走 `fromHostValue` 校验并返回。
  - try/catch：模块抛的异常包装成 `RuntimeError`，消息 `<scheme> tool '<tool>.<method>' failed: <msg>`；stack 不进 trace。
- `call({ method, args })` 特例处理：
  - `request.method === "call"` 且 args 是 `[{ method, args }]` 的形式时：从参数对象里取出实际 method 和 args list，再走 `invokeModuleMember`。
  - 校验：`method` 必须是非空字符串；`args` 必须是 list；否则报错。

`NodeToolProvider` 只和 `NpmToolProvider` 的区别是 `checkNodeImport` 解析、import target 用 `node:<mod>`、没有 version 校验。

验收：

- 调用未授权的 `npm:` 包在 runtime 报错。
- 调用未安装的 `npm:` 包在 runtime 报加载失败错误。
- version 校验命中 / 不命中两条路径。
- method 不存在 / 不是函数 / 抛异常三条路径。
- Promise 返回值自动 await。
- 属性读取对 primitive / plain object 正常；对 function / class 拒绝。

## 阶段 4：接入默认 ToolProvider

状态：已完成。

修改：

```text
src/providers/tools/host.ts
```

实现项：

- `HostToolProvider(workspaceRoot)` 构造时：
  - 读取 `NpmRegistry`；
  - 用 `NpmToolProvider` 处理 `npm` scheme；
  - 用 `NodeToolProvider` 处理 `node` scheme；
  - 与 `env`、`file`、`http`、`https`、`mcp`、`sh` 一起放入内部 scheme map。
- `createDefaultToolProvider(workspaceRoot)` 直接返回 `HostToolProvider`。
- `SchemeToolProvider` 作为公开组合工具保留，但默认 provider 不再额外包一层。
- 确保 `HostToolProvider.close()` 不重复关闭同一 child provider。

验收：

- `.as` 中 `import tool Yaml from "npm:yaml"` 能走到 `NpmToolProvider`。
- 其它 scheme 行为不变。

## 阶段 5：Semantic 边界

状态：计划中。

修改：

```text
src/semantic/parallel-for.ts
（可能涉及 src/semantic/scope.ts）
```

实现项：

- 扩展 effectful scheme 集合：`EFFECTFUL_TOOL_SCHEMES = new Set(["sh", "mcp", "http", "https", "file", "npm", "node"])`（`file` 已存在；此处据实对齐）。把 `npm`、`node` 加入。
- `checkParallelForBodyRules`：对 `tool` import 的 member call，若其 import URI scheme 属于 effectful 集合，报 effectful 错误。
- `--check` 层面：对 `import tool ... from "npm:..."` / `"node:..."` 的 URI 运行 `checkNpmImport` / `checkNodeImport`，未授权则报错；只做白名单匹配，不做 installed version / method 探测。这需要 semantic analyzer 能访问 registry。
  - 传入 registry 的方式：semantic `analyze(program, options?)` 增加可选参数；CLI `runCheck` 里加载 registry 后传入。现有签名只有 `analyze(program)`，可保持向后兼容：无 options 时跳过 npm 白名单检查，但运行时仍会校验。
  - 推荐：semantic 增加 `analyze(program, { npmRegistry? })` 新签名，`--check` 默认尝试读 registry，读不到则跳过；读到则严格校验。

验收：

- `parallel for` body 内 `Yaml.parse(...)` 被 semantic 拒绝。
- `--check` 对未授权 `npm:` import 报错；有授权则通过。
- 现有所有测试保持绿。

## 阶段 6：Runtime 集成

状态：计划中。

修改：

```text
src/runtime/interpreter.ts
src/index.ts
```

实现项：

- Interpreter 构造时：默认 `toolProvider = createDefaultToolProvider(workspaceRoot)` 已经包含 npm/node provider。
- 不改 `ExecuteOptions` 签名；`workspaceRoot` 已存在。
- `--dry-run` 路径：
  - `DryRunToolProvider` 的最简做法是让 npm/node 调用直接返回 `null`，但现有 CLI 没有 tool 层的 dry-run wrapper。Phase 1 方案：只在 LLM 层做 dry-run（现状）；若需要 tool dry-run，走 `--mock` + 替换 `toolProvider`。
  - 推荐：Phase 1 仍然只 short-circuit LLM；npm/node 在 dry-run 下会真实调用。文档里注明。**待决**：若用户反馈强烈需要 tool-level dry-run，后续版本补 `DryRunToolProvider`。为了与 v4-design 一致，Phase 1 还是推荐补上：简单做法是在 CLI 层的 `--dry-run` 时用 `SchemeToolProvider` 把 `npm` / `node` 换成一个返回 `null` 的 dummy。
  - **决策**：Phase 1 落地 dummy npm/node provider 的 dry-run 版本；实现量小，符合 design。

验收：

- 真实运行 `examples/npm-yaml.as` 能 parse YAML。
- `--dry-run` 不触发 `import()` 实际调用。
- `--mock` 行为不变。

## 阶段 7：Trace 与错误

状态：计划中。

实现项：

- `uriScheme("npm:yaml")` 和 `uriScheme("node:path")` 已经能返回 `npm` / `node`（现有实现用 URL 解析，这两种形式合法）。
- evaluator 现有 tool trace 事件已填 `scheme: uriScheme(object.uri)`，无需改动。
- 错误消息在 `NpmToolProvider` / `NodeToolProvider` 中统一格式化。

验收：

- `--trace` 输出中 `scheme` 为 `npm` 或 `node`。
- 错误消息含 tool 名、method 名、原因，不含 stack。

## 阶段 8：测试

状态：计划中。

新增测试：

```text
tests/npm-registry.test.ts
tests/npm-tool.test.ts
tests/node-tool.test.ts
tests/host-marshal.test.ts
```

fixture：

```text
tests/fixtures/npm.as
tests/fixtures/agentscript.npm.json
tests/fixtures/fake-npm-pkg/package.json
tests/fixtures/fake-npm-pkg/index.js
```

fake-npm-pkg 放一个最简单的 ESM 包：

```js
// tests/fixtures/fake-npm-pkg/index.js
export function hello(name) { return { greeting: `Hi, ${name}` }; }
export async function slow(ms) {
  await new Promise(r => setTimeout(r, ms));
  return ms;
}
export const CONSTANT = "fixed";
export function getBad() { return new Map(); }  // 触发 marshal 拒绝
```

为了让 `import("fake-npm-pkg")` 命中 fixture 包，测试中设定 `workspaceRoot` 为 `tests/fixtures/fake-workspace`，其中 `node_modules/fake-npm-pkg/` symlink 到 fixture 目录；或者直接用绝对路径的 `package.json` + `node_modules` 结构。

覆盖点：

- registry：
  - 无 registry 拒绝所有。
  - allow.npm 命中 / 未命中。
  - allow.node 命中 / 未命中。
  - sub-path 允许 / 拒绝。
  - version 校验命中 / 未命中 / 跳过。
  - malformed registry 错误路径准确。
- npm tool：
  - 正常调用返回对象 / primitive。
  - 属性读取（`CONSTANT`）。
  - async 函数自动 await。
  - 返回值是 `Map` / class instance 被 marshal 拒绝。
  - 参数里带 binding 被拒绝。
  - `call({ method, args })` 形式正常。
  - method 不存在报错。
- node tool：
  - `node:path` 的 `join`、`sep` 正常。
  - `node:crypto` 的 `randomUUID`（如果允许）正常。
  - 未授权的 node 模块被拒绝。
- host-marshal：
  - 循环引用。
  - `undefined` 在 object / list 中。
  - BigInt / Symbol / 函数。
  - binding 值拒绝。
- semantic：
  - `parallel for` body 内 npm/node 成员调用被拒绝。
  - `--check` 对未授权 import 报错。

## 阶段 9：CLI

状态：计划中。

Phase 1 不新增 CLI 参数。

行为：

- 默认 CLI run 使用 workspace root 下的 `agentscript.npm.json`。
- `--check` 尝试读同一文件；读不到则跳过 npm 白名单检查（保留 backward compat），读到则严格。
- `--dry-run` 对 npm/node tool 返回 `null`。
- `--mock` 不影响 npm/node provider。

可选（后续版本）：`--allow-npm pkg` 临时授权（V4 不做，保持 registry 单一入口）。

## 阶段 10：文档最小更新

状态：计划中。

- `docs/en/language.md` / `docs/cn/language.md`：在 tool URI scheme 列表里追加 `npm://` 和 `node://` 两行，标注"需要 `agentscript.npm.json`"。
- README / README-CN：增加一节"Calling npm packages"，附最小示例。
- 新增 `docs/en/npm-tools.md` / `docs/cn/npm-tools.md`：解释 registry、限制、marshal 规则、常见陷阱（class 实例、Buffer、Stream）。
- CHANGELOG 增加 V4 条目。

## 阶段 11：示例

状态：计划中。

新增 `.as` 示例：

```text
examples/npm-yaml.as
examples/npm-marked.as
examples/node-crypto.as
```

以及对应 `agentscript.npm.json` 片段（可放在 `examples/agentscript.npm.json` 作为共用白名单，或每个示例一份）。

推荐内容：

- `npm-yaml.as`：读文件 + 解析 YAML front matter，展示 node + npm 联合使用。
- `npm-marked.as`：把 Markdown 转成 token array，截一段作为 LLM summarization 的 `use`。
- `node-crypto.as`：用 `randomUUID` 生成 run id，展示纯 Node 能力。

示例必须能通过 `agentscript example.as --mock` 跑完（LLM 走 mock，tool 真跑）。

## 实施顺序建议

推荐顺序：

1. Marshal 工具（阶段 2）——基础模块。
2. Registry 加载（阶段 1）——可独立测试。
3. NodeToolProvider（阶段 3 的 node 部分）——不涉及 version，路径最短。
4. NpmToolProvider（阶段 3 的 npm 部分）——在 node 版本上加 registry + version。
5. SchemeToolProvider 接入（阶段 4）。
6. Semantic 扩展（阶段 5）。
7. Runtime dry-run 支持（阶段 6）。
8. Trace/错误细化（阶段 7）。
9. 测试（阶段 8）。
10. CLI 不变（阶段 9），文档与示例（阶段 10、11）。

原因：

- marshal 被 node / npm provider 共用，先完成降低后续返工。
- node provider 比 npm 简单，可以验证整条调用链。
- npm provider 再在 node 基础上加 registry + version 校验。
- semantic 独立于 runtime，可并行。

## 风险与取舍

### dynamic import 的缓存策略

风险：用户希望"改了 node_modules 立刻生效"；但重复 `import()` 命中 Node ESM loader 缓存。

Phase 1 处理：

- 不尝试主动失效 Node loader 缓存。
- 同一 `executeAgent` 内缓存命中。
- REPL 下每次 run 创建新的 provider；但 Node loader 缓存仍在，这是 Node 本身行为。
- 文档明确说明：修改 node_modules 需要重启进程。

### 简化的 semver 支持

风险：手写 semver 子集与完整 `semver` 包的行为可能不一致。

Phase 1 处理：

- 支持的 range 形式文档化。
- 遇到不支持的 range 直接报 "Unsupported version range" 错误，不悄悄假设通过。
- 未来可以允许用户通过 flag 开启"跳过版本校验"模式，目前不需要。

### class 实例的拒绝策略

风险：很多常用包的 API 返回类实例（例 `new Date()`、`URL`、`Headers`）。

Phase 1 处理：

- 一律拒绝；错误消息提示"class instance not JSON-safe"。
- 用户自己在 `.as` 层或者在 shim npm 包里把对象序列化后使用。
- 与设计哲学一致："做得到的包就能直接用，做不到的 Phase 1 不支持"。

### 与 `agentscript.mcp.json` 的并存

风险：两个 registry 文件容易混淆。

Phase 1 处理：

- 文件名保持独立：`.mcp.json`（V3）和 `.npm.json`（V4）。
- 后续 V6 可以考虑合并到统一 config，但不是 Phase 1 的事。

### capability vs 便利

风险：registry 白名单严格，用户上手第一步就要写配置。

Phase 1 处理：

- 这是设计原则，不放开。
- 文档提供 copy-paste 起步模板。
- 报错信息直接告诉用户"在 agentscript.npm.json 的 allow.npm 里加 '<pkg>'"。

### 命名冲突：V5 的 HostToolProvider

风险：V5 设计里有 `HostToolProvider`（embed host），与现有 `src/providers/tools/host.ts::HostToolProvider` 同名。

Phase 1 处理：

- 现有的 `HostToolProvider` 指的是"Node host，默认实现"。V5 的 embed provider 在该文档中已建议改名为 `EmbeddedHostToolProvider` 或类似。
- V4 不改现有命名；V5 实施时再决定。

### zero dependency 承诺

风险：semver 子集、AbortSignal、WeakSet 都用 Node 内置；但 dynamic `import()` 需要 Node `>=22.13`，这个 engines 要求已存在。

Phase 1 处理：

- 仍然满足零 npm 依赖。
- 文档保留 `engines.node >= 22.13` 声明。

## 完成标准

V4 Phase 1 完成时应满足：

- `import tool X from "npm:pkg"` 可运行，前提是宿主已 npm install 且 registry 授权。
- `import tool X from "node:module"` 可运行，前提是 registry 授权。
- `X.method(a, b, ...)` 支持 positional 调用，自动 await Promise。
- `X.property` 支持 JSON-safe 属性读取。
- `X.call({ method, args })` 作为动态 method 入口可用。
- 参数 marshal 拒绝 binding 与非 JSON-safe 值。
- 返回值 marshal 拒绝 class 实例、Buffer、Stream、循环引用等。
- `parallel for` body 内 `npm:` / `node:` 成员调用被 semantic 拒绝。
- `--check` 对未授权 import 报错；不真实 `import()` 模块。
- `--dry-run` 不触发实际模块调用。
- trace 中 `scheme` 为 `npm` / `node`；错误消息清晰。
- `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build` 全部通过。
- README / language 文档反映新能力；examples 至少三个运行示例。
- 不新增 runtime dependency；marshal 工具由 V5 复用。
