# AgentScript V5 Design

V5 的目标是让 AgentScript 与宿主语言互操作。宿主语言（host language）指嵌入或调用 AgentScript 运行时的通用编程语言。

V5 Phase 1 仅支持 TypeScript 作为宿主。它覆盖两个方向：

1. **Host → AgentScript**：TypeScript 代码把 `.as` 程序嵌入进自身流程，注入 LLM provider、tool、memory，读取结果和 trace。
2. **AgentScript → Host**：`.as` 程序通过 `import ... from "host://..."` 调用 TypeScript 侧注册的函数、模型、memory 实现。

V5 不改变 AgentScript 的语言语义：`use` 仍是唯一的 prompt context 选择机制，`generate` 仍是唯一的 LLM 调用点，scope 仍是 context boundary。host 互操作是一种 provider extension，不是新的语言特性。

## 目标

V5 Phase 1 支持：

- `import tool X from "host://..."` 调用宿主函数。
- `import llm X from "host://..."` 使用宿主注册的模型实现。
- `import memory X from "host://..."` 使用宿主注册的 memory 后端。
- 宿主通过 `executeAgent(program, input, options)` 嵌入执行 AgentScript 程序。
- 宿主可以用 TS 函数注册单个 tool/llm/memory provider，无需实现完整 provider 接口。
- AgentScript 值与 TS JSON 值的双向 marshal 规则明确。
- Host 异常被翻译为 `RuntimeError`，并带有 tool 名称和调用位置。
- Host provider 的调用写入现有 trace，`scheme` 字段为 `host`。
- 不引入 runtime dependency。
- capability 模型不变：只有显式 `import` 的 host 资源才会被 `.as` 调用。

V5 Phase 1 不支持：

- 除 TypeScript 以外的宿主语言。
- AgentScript 源码直接引用 TS 函数闭包、class 实例、Node API。
- host tool 返回值自动进入 prompt（依然需要 `use`）。
- 从 AgentScript AST 生成 TS 类型定义（`.d.ts`）。
- AgentScript 作为 NPM 独立 runtime 在浏览器 / Deno / Bun 的适配（默认遵循 `package.json` 的 `engines.node`）。
- Streaming generate / partial results。
- host 异步 iterator / callback / AbortSignal 透传超出最小必需范围。
- Hot reload 与 `.as` 源码的监听重编译。
- 把 host 函数传进 `.as` 做为一等公民值（即 AgentScript 不能把 TS 函数存入变量再调用）。

## 与语言的关系

AgentScript 语法不变：

```agentscript
import tool Search from "host://search"
import llm Fast from "host://fast"
import memory Lessons from "host://lessons"

main agent Researcher {
    model Fast
    role "Researcher"
    description "Answer with host search."

    main func(input { question: string }) {
        past = Lessons.query({
            kind: "lesson",
            limit: 3
        })

        result = Search.web_search({
            query: input.question
        })

        use input.question as "user question"
        use past max 2k as "past lessons"
        use result.text max 4k as "search results"

        generate({
            input: "Answer from selected context"
        }) -> {
            answer
            citations: list[string]
        }
    }
}
```

- `host://search`、`host://fast`、`host://lessons` 三条 URI 都走新的 host scheme，但 parser、AST、import 语义不变。
- host tool/memory 的返回值仍是普通 `RuntimeValue`，只有 `use` 才让它进入 prompt。
- host llm 被 `model Fast` 选中后，runtime 在 `generate` 时把 prompt 交给宿主注册的 generator。

## URI 语义

host URI 采用 registry 风格：

```text
host://<name>[/<path>]
```

规则：

- scheme `host` 固定。
- hostname 部分是 registry key。
- 可选的 path 段留给后续扩展（namespace、版本），Phase 1 忽略或只要求前缀匹配，具体以实现中的 lookup 规则为准。
- `.as` 源码中不出现任何宿主实现细节。
- registry 不来自 `.as`，也不来自磁盘配置，而是来自宿主启动 runtime 时传入的 options。

示例 registry（来自 TS 侧）：

```ts
executeAgent(program, input, {
  hostTools: {
    search: {
      web_search: async ({ query }: { query: string }) => {
        const data = await myHttpClient.post("/search", { query });
        return { ok: true, text: data.summary, items: data.items };
      }
    }
  },
  hostLlms: {
    fast: async (request) => myGenerateFn(request)
  },
  hostMemories: {
    lessons: myMemoryImpl
  }
});
```

- `import tool Search from "host://search"` 在运行时找到 `hostTools.search`。
- `import llm Fast from "host://fast"` 在 `generate` 时交给 `hostLlms.fast`。
- `import memory Lessons from "host://lessons"` 在 `Lessons.add(...)` / `Lessons.query(...)` 时交给 `hostMemories.lessons`。

选择 `host://` 而不是 `ts://` 的原因：

- 未来 Python、Rust 宿主同样可以注册 host provider，无需引入每种语言一个 scheme。
- 它表明"由嵌入 AgentScript 的宿主应用提供"，而不是特定运行时。
- scheme 中不编码实现细节，和 `mcp://` 的风格一致。

## 值 Marshal

AgentScript 的 `RuntimeValue` 已经是 JSON-oriented：`string`、`number`、`boolean`、`null`、`RuntimeValue[]`、`Record<string, RuntimeValue>`，再加上 `*Binding` 标签值。

Phase 1 规定：

- **AgentScript → TS**：host 函数收到的所有参数必须是纯 JSON 值。调用前 runtime 用现有 `sanitizeForJson` 规则清洗，去掉所有 `*Binding` 包装、函数绑定、或任何非 JSON 字段；若检测到 binding 出现在实际传入的 args 中，runtime 报错而不是静默丢弃。
- **TS → AgentScript**：host 函数返回值必须是 JSON-safe。runtime 做：
  - 允许 `string`、`number`、`boolean`、`null`、普通数组、普通 object。
  - 拒绝 `undefined`、函数、Symbol、class 实例（除非是 `Date`、`URL` 这类可序列化对象，且 Phase 1 不自动处理，要求宿主自己先序列化）、循环引用、`BigInt`（未来可能放开）。
  - 任何不符合的值被包装为 RuntimeError，错误消息指出 tool 名称、method、问题路径。
- **undefined 与 null**：TS 的 `undefined` 在 JSON 里无对应，runtime 一律拒绝；若 host 想表达缺值应返回 `null`。
- **大对象**：runtime 不自动截断。与 MCP 一致，prompt 侧由 `use ... max ...` 控制；trace 侧沿用现有 sanitize 行为。

Phase 1 不做深 schema 校验。如果宿主 tool 的协议对返回值有要求，由宿主自己校验。

## Host Tool 调用

### 注册形式

```ts
interface HostToolRegistry {
  [toolName: string]: HostToolImpl;
}

interface HostToolImpl {
  [method: string]: HostToolMethod;
}

type HostToolMethod = (
  args: JsonObject,
  context: HostCallContext
) => Promise<JsonValue> | JsonValue;

interface HostCallContext {
  tool: string;
  method: string;
  uri: string;
  signal: AbortSignal;
}
```

- `args` 总是一个 JSON object。多参数或非 object 参数的 AgentScript 调用在 runtime 报错。
- `context.signal` 是执行被取消时的 abort 信号，Phase 1 可能只做 best-effort（CLI 未提供取消路径时，可退化为 never-aborted signal）。
- 返回值可以是同步值或 Promise。

### 调用映射

AgentScript：

```agentscript
result = Search.web_search({ query: "agentscript" })
```

映射：

```text
hostTools.search.web_search({ query: "agentscript" }, context)
```

规则：

- AgentScript method name 必须是 `HostToolImpl` 的一个键。
- 允许 0 或 1 个参数。0 参数时 `args` 为 `{}`。
- 如果存在第 1 个参数，它必须是 object；否则 runtime 报错。
- 调用前 runtime 已经处理 identifier 与 call 语义。
- 调用后 runtime 做返回值 marshal 校验（参见上节）。

### 保留 method 名

Phase 1 不预留 `call({ tool, args })` 形式。宿主应直接用合法 identifier method name（这比 MCP 容易做到，因为 host 完全由宿主控制）。

如果未来需要支持动态 method 名（比如 host 把 MCP 桥接进 AgentScript），可以追加 `call` 约定，但不在 Phase 1。

### 错误

- 如果 AgentScript 调用未注册的 tool name：报 `Unknown host tool '<name>'`。
- 如果 tool 已注册但 method 不存在：报 `Unknown host tool method '<tool>.<method>'`。
- 如果 host method 抛异常：包装为 `RuntimeError`，消息格式为 `Host tool '<tool>.<method>' failed: <message>`，保留原始 stack 到调试输出。
- 如果 host method 返回非 JSON-safe：报 `Host tool '<tool>.<method>' returned invalid value: <reason>`。

错误消息必须带 tool 名称和 method 名，帮助定位；不直接输出 stack 到 trace（trace 里保留 message 和 code 即可）。

## Host LLM Provider

AgentScript 的 `LlmProvider` 接口已存在。V5 新增一个"薄函数形式"，让宿主不必实现完整 class：

```ts
type HostLlmHandler = (
  request: GenerateRequest
) => Promise<RuntimeValue> | RuntimeValue;

interface HostLlmRegistry {
  [modelName: string]: HostLlmHandler;
}
```

- `GenerateRequest` 已导出，包括 `instruction`、`context`、`builtContext`、`returnContract`、`maxOutput`、`temperature`、`think`、`strict`、`debug` 等。
- handler 返回值作为 `generate` 的结果，经过现有 contract 校验与 coercion 流程；即 host handler 不需要手动做 contract validation。
- host handler 只在 `import llm X from "host://X"` + `model X` 同时满足时被选中。
- 若该 model 没有注册，runtime 报 `Unknown host llm '<name>'`。
- 若 AgentScript 用 `--dry-run`，host LLM 不会被调用，这与现有 dry-run 语义一致。
- trace 的 `generate` kind 事件不变；`identity` 里保留 `model.name` 和 `model.uri`（`host://...`）。

这个设计让 Phase 1 的宿主可以在几行 TS 里接入任意 LLM SDK，而不必理解 protocol adapter 结构。

## Host Memory Provider

AgentScript 的 `MemoryProvider` 也是接口。V5 允许宿主只传一个实现对象：

```ts
interface HostMemoryImpl {
  add(record: JsonObject, context: HostMemoryContext): Promise<JsonValue> | JsonValue;
  query(query: JsonObject, context: HostMemoryContext): Promise<JsonValue> | JsonValue;
}

interface HostMemoryRegistry {
  [memoryName: string]: HostMemoryImpl;
}

interface HostMemoryContext {
  memory: string;
  uri: string;
  signal: AbortSignal;
}
```

- `Lessons.add({ ... })` 调用 `hostMemories.lessons.add(...)`。
- `Lessons.query({ ... })` 调用 `hostMemories.lessons.query(...)`。
- 现有的 `trace` `memory` kind 事件保留。
- host memory 不自动写入 prompt，query 结果仍需 `use` 选择。
- Memory record 由宿主自行决定是否生成 `id`、`created_at` 等字段；runtime 不再强加字段规范（这与 V2 file/sqlite 后端的约定不同，host 的约定交给宿主）。

## Host 嵌入 API

从 Host → AgentScript 这侧，V5 Phase 1 补齐以下 API：

```ts
interface ExecuteOptions {
  agentName?: string;
  concurrency?: number;
  functionName?: string;
  sourcePath?: string;
  workspaceRoot?: string;

  llmProvider?: LlmProvider;
  inputProvider?: InputProvider;
  memoryProvider?: MemoryProvider;
  toolProvider?: ToolProvider;

  // V5 新增
  hostTools?: HostToolRegistry;
  hostLlms?: HostLlmRegistry;
  hostMemories?: HostMemoryRegistry;

  signal?: AbortSignal;
}
```

规则：

- 如果同时传了 `toolProvider` 和 `hostTools`，runtime 把 `hostTools` 包装成一个 host scheme provider，再合并进 `SchemeToolProvider`（与 `createDefaultToolProvider` 返回的一致）。显式提供的 `toolProvider` 负责非 host scheme；host scheme 总是优先走 `hostTools` 提供的映射。
- `hostLlms` 覆盖现有 `llmProvider` 对 `host://` URI 的处理。若 `llmProvider` 未能处理某个 `host://` URI，runtime 才回落到 `hostLlms`；但推荐宿主统一用 `hostLlms`，把 `llmProvider` 保留给 `openai://`、`anthropic://` 这类 protocol provider。
- `hostMemories` 同理。
- `signal` 被向下传递给 host provider 的 `context.signal`。现有 `LlmProvider.generate` 接口没有 signal 字段，V5 Phase 1 暂不改动它，仅在 host 的薄函数形式里提供 signal。

返回结果不变：

```ts
interface ExecuteResult {
  value: RuntimeValue;
  trace: TraceEvent[];
}
```

### Load + Execute 便捷入口

```ts
import { loadProgramSource, executeAgent } from "@rong/agentscript";

const program = loadProgramSource(source, { sourcePath });
const { value, trace } = await executeAgent(program, input, options);
```

Phase 1 不新增 `run(source, input, options)` 这种一步接口。保留 load/execute 分离是为了：

- 宿主可以对同一 program 多次执行（REPL、warm loop）。
- 宿主可以独立做 `--check` 静态分析。
- 避免 `run` 成为 AgentScript API surface 的杂糅入口。

## capability 与边界

V5 不改变 capability 模型：

- `import tool X from "host://..."` 仍然是显式 capability 声明。
- host tool 返回值不会自动进入 prompt。
- host llm 不会自动 `use` 任何数据。
- scope 规则不变。

新增的 capability 与边界细节：

- 宿主在启动时必须显式传入 `hostTools`、`hostLlms`、`hostMemories`。如果 `.as` 程序 `import host://foo` 但宿主未注册 `foo`，runtime 在首次使用时报错；这保证 capability 不会被静默授予。
- host tool 默认视为 effectful，`parallel for` body 中禁止调用。若宿主需要放宽，可在 handler 的元信息中标记 `pure: true`（形式详见实施文档），这是未来可选扩展，Phase 1 只按 effectful 对待。
- host llm / host memory 在语言层面本来就不会出现在 `parallel for` body 内（generate 在 parallel body 中不允许 shared state），语义和现在一致。

## Trace

Host 调用使用现有 `tool`、`memory`、`generate` trace kind。只扩展 `scheme` 字段为 `host`。

host tool 示例：

```json
{
  "kind": "tool",
  "data": {
    "tool": "Search",
    "method": "web_search",
    "scheme": "host",
    "uri": "host://search",
    "args": [{ "query": "agentscript" }],
    "result": { "ok": true, "text": "...", "items": [] },
    "effects": null
  }
}
```

host llm 在 `generate` 事件的 `identity.model.uri` 里会显示 `host://fast`，其它字段保持不变。

host memory 在 `memory` 事件的 `uri` 里会显示 `host://lessons`，其它字段保持不变。

原则：

- host 调用不应在 trace 中暴露闭包或 class 内部。
- host 调用异常的 message 可出现在 trace，但 stack 不应。

## `--check` 与静态分析

`agentscript --check` 保持完全静态，不执行 host 回调。

具体：

- semantic analyzer 不看 `hostTools` 等 runtime registry。
- `import tool X from "host://..."` 通过现有 tool import 语义检查；URI scheme 不需要新增专门规则，但 analyzer 会识别 `host://` 并对 `parallel for` body 中的 host tool method call 报 effectful 错误（和 MCP 一致）。
- `import llm X from "host://..."` 照常作为 llm binding 存在，`model X` 语义不变。
- `--check` 不报"host tool 未注册"这类运行时错误。

## `--dry-run`

`--dry-run` 不调用 host provider。行为：

- host tool：如同现有 mock 语义，直接跳过调用，返回 `null`（或由宿主注册一个 dry-run 替身，但 Phase 1 不做）。
- host llm：由现有 DryRunLlmProvider 取代，不调用 host handler。
- host memory：Phase 1 按现有行为直接跳过（query 返回 `[]`，add 返回 `null`）；若这不够细腻，后续可引入 `DryRunMemoryProvider`。

Phase 1 可以先只保证"dry-run 不触发 host 回调"，细节行为做最小可接受实现。

## 与 V3 MCP 的关系

- V5 新增 scheme `host://`；不影响 `mcp://`。
- host provider 是 TS 原生函数注册，不启动子进程；MCP 永远走 stdio 子进程。
- 如果宿主希望把 host tool 转发成 MCP server，属于用户应用的桥接代码，不在语言或 runtime 职责内。

## 非目标

V5 Phase 1 明确不做：

- 从 AgentScript 调用 TS 中的任意 module export：仅允许通过 host registry 的 tool/llm/memory 形式。
- 把 TS 的 class 对象、函数、Promise、iterator 作为 `RuntimeValue` 存活在 AgentScript scope 中。
- 反向把 AgentScript 的 agent 作为 TS 可直接调用的 function 暴露（当前 `executeAgent` 已足够，不需要额外 wrapper）。
- 从 AgentScript AST 生成 TS 类型：即便以后要做，也是独立工具。
- AgentScript 侧的模块化（多文件 `import` 已经由 v1 `import agent` 处理；host 不参与）。

## 开放问题

以下问题需要在实施前拍板：

- host tool 在 `parallel for` 中是否一律拒绝，还是保留一个 `pure: true` opt-in 入口？**推荐：Phase 1 一律拒绝，opt-in 留给后续版本。**
- host memory record 是否保留 v2 的自动 `id` / 时间戳规范？**推荐：Phase 1 交给宿主自己负责；runtime 只做 marshal。**
- `hostLlms` 与 `hostMemories` 是否应被统一成一个 `HostProviderRegistry`？**推荐：拆开，三者语义不同（tool 多 method，llm 单入口，memory 固定两个方法）。**
- `host://` 是否允许多段 path（如 `host://team/search`）？**推荐：Phase 1 允许，lookup 时用整个 `host://name/path` 字符串去掉 `host://` 前缀作为 registry key。**
- 是否提供类型辅助函数（`defineHostTools`、`defineHostLlm`、`defineHostMemory`）？**推荐：提供，仅是 identity 函数 + 类型推断，不增加 runtime。**
- 是否在 Phase 1 就允许宿主替换整个 `ToolProvider`？**已支持，`ExecuteOptions.toolProvider` 已经导出。**

## 设计不变式

V5 Phase 1 完成后仍必须成立：

- `use` 是唯一让数据进入 prompt 的方式。
- `generate` 是唯一 LLM call site。
- scope 控制 context 可见性。
- capability 显式：host 能做什么由宿主通过 registry 授予，`.as` 能看什么由 `import` 决定。
- trace 覆盖所有 host 调用。
- host 异常不会静默；总是翻译成 AgentScript runtime 错误。
- AgentScript runtime 不依赖任何 npm package。
