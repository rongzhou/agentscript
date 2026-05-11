# AgentScript V5 实施计划

本文档描述 V5 Phase 1 的实施方案。V5 设计见 `v5-design.md`。

V5 Phase 1 的实现目标是让 TypeScript 作为宿主语言与 AgentScript 双向互操作。它不改变语言语法，不引入 runtime dependency，不增加新的语言关键字。所有工作集中在 providers、runtime entry options、错误/trace 细节与文档上。

## 原则

- host 互操作是 provider extension，不是语言特性。
- `import tool/llm/memory X from "host://..."` 复用现有 import 语义。
- host provider 的返回值是普通 `RuntimeValue`，不会自动进入 prompt。
- `--check` 不触发 host 回调。
- `--dry-run` 不触发 host 回调。
- runtime 错误必须带 tool/memory/method 名和 `host://` URI。
- trace 沿用现有 `tool`、`memory`、`generate` kind，只把 scheme 填为 `host`。
- 不引入任何 npm 依赖。

## 阶段 1：类型定义与公共 API 表面

状态：计划中。

新增一个 host-facing 模块，集中 V5 的类型与帮助函数。推荐位置：

```text
src/providers/host/index.ts
src/providers/host/types.ts
```

新增类型：

```ts
// src/providers/host/types.ts
import type { AbortSignal } from "node:abort-controller"; // 使用内置 AbortSignal 即可
import type { GenerateRequest, JsonObject, JsonValue, RuntimeValue } from "../../runtime/types.js";

export interface HostCallContext {
  tool: string;
  method: string;
  uri: string;
  signal: AbortSignal;
}

export type HostToolMethod = (
  args: JsonObject,
  context: HostCallContext,
) => Promise<JsonValue> | JsonValue;

export type HostToolImpl = Record<string, HostToolMethod>;

export type HostToolRegistry = Record<string, HostToolImpl>;

export type HostLlmHandler = (
  request: GenerateRequest,
) => Promise<RuntimeValue> | RuntimeValue;

export type HostLlmRegistry = Record<string, HostLlmHandler>;

export interface HostMemoryContext {
  memory: string;
  uri: string;
  signal: AbortSignal;
}

export interface HostMemoryImpl {
  add(record: JsonObject, context: HostMemoryContext): Promise<JsonValue> | JsonValue;
  query(query: JsonObject, context: HostMemoryContext): Promise<JsonValue> | JsonValue;
}

export type HostMemoryRegistry = Record<string, HostMemoryImpl>;
```

帮助函数（仅是 identity，带类型推断）：

```ts
export function defineHostTools<T extends HostToolRegistry>(tools: T): T {
  return tools;
}

export function defineHostLlm(handler: HostLlmHandler): HostLlmHandler {
  return handler;
}

export function defineHostMemory<T extends HostMemoryImpl>(memory: T): T {
  return memory;
}
```

导出到 `src/index.ts`：

- 类型：`HostCallContext`、`HostToolMethod`、`HostToolImpl`、`HostToolRegistry`、`HostLlmHandler`、`HostLlmRegistry`、`HostMemoryContext`、`HostMemoryImpl`、`HostMemoryRegistry`。
- 函数：`defineHostTools`、`defineHostLlm`、`defineHostMemory`。

验收：

- `import { defineHostTools } from "@rong/agentscript"` 可用。
- 类型推断能把 `HostToolRegistry<T>` 的 key 推断为字面量字符串联合类型。
- 本阶段不改动 runtime。

## 阶段 2：Value Marshal 工具

状态：计划中。

新增模块：

```text
src/runtime/host-marshal.ts
```

职责：

- `toJsonArg(value: RuntimeValue, context): JsonValue`：把 AgentScript 运行时值转换为 JSON-safe 值，供 host 调用使用。需要拒绝任何 binding 值（`ToolBinding`、`LlmBinding`、`MemoryBinding`、`AgentBinding`、`FunctionBinding`）。
- `fromHostValue(value: unknown, context): RuntimeValue`：把 host 返回值校验后转为 `RuntimeValue`。拒绝 `undefined`、函数、Symbol、BigInt、class 实例、循环引用、non-serializable Map/Set。
- `requireJsonObject(value, context)`：host tool 参数必须是 object；错误时抛带定位的 `RuntimeError`。

实现建议：

- 复用 `isObject`、`sanitizeForJson` 的部分逻辑；但 `sanitizeForJson` 是 trace 用途，允许 drop binding，这里必须**拒绝**而非 drop。因此另写一套轻量递归。
- 对 `BigInt` 直接报错：Phase 1 不支持。未来放开需要决定 JSON 表达。
- 对循环引用用 `WeakSet<object>` 做访问跟踪。
- 所有错误统一 `HostMarshalError extends RuntimeError`，带 `path`（如 `result.items[3].text`），消息模板：
  - `Host tool '<tool>.<method>' returned invalid value at <path>: <reason>`。
  - `Host tool '<tool>.<method>' received AgentScript resource binding at <path> which cannot be passed across host boundary`。

验收：

- `{ a: 1, b: "x" }` 原样通过。
- 含 `undefined` 字段被拒绝。
- 含 tool binding 的 value 被拒绝（避免把 `Search` binding 当参数传过去）。
- `toJsonArg` 允许只读拷贝，不会在原 runtime value 上产生副作用。

## 阶段 3：HostToolProvider

状态：计划中。

新增模块：

```text
src/providers/host/tool.ts
```

实现：

```ts
export class HostToolProvider implements ToolProvider {
  constructor(
    private readonly registry: HostToolRegistry,
    private readonly signal: AbortSignal,
  ) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const key = hostRegistryKey(request.uri);
    const impl = this.registry[key];
    if (!impl) {
      throw new RuntimeError(`Unknown host tool '${key}' for ${request.uri}`);
    }
    const method = impl[request.method];
    if (!method) {
      throw new RuntimeError(
        `Unknown host tool method '${key}.${request.method}' for ${request.uri}`,
      );
    }

    const args = hostToolArgs(request, key);
    const context: HostCallContext = {
      tool: key,
      method: request.method,
      uri: request.uri,
      signal: this.signal,
    };

    let raw: unknown;
    try {
      raw = await method(args, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(`Host tool '${key}.${request.method}' failed: ${message}`);
    }

    return fromHostValue(raw, {
      label: `host tool '${key}.${request.method}' result`,
    });
  }
}
```

说明：

- `hostRegistryKey(uri)` 去掉 `host://` 前缀作为 registry 查找键；允许 `host://team/search` 这种多段路径整体作为 key，但也允许未来引入分段映射。
- `hostToolArgs(request, key)`：`request.args` 为 0 或 1 个参数；0 参数返回 `{}`；1 参数必须是 object，否则报 `Host tool '<key>.<method>' expects an object argument`；>=2 个参数报 `Host tool '<key>.<method>' expects at most one argument`。
- 返回值通过 `fromHostValue` 统一 marshal 和校验。
- AbortSignal 由上层注入。没有用户取消机制时传入一个 never-aborted signal 即可。

验收：

- 注册的 tool 被正确调用；未注册报带名错误。
- 抛异常被包装为 RuntimeError。
- 非 JSON 返回被拒绝。
- tool binding 作为参数传入被拒绝。

## 阶段 4：HostLlmProvider

状态：计划中。

新增模块：

```text
src/providers/host/llm.ts
```

实现：

```ts
export class HostLlmProvider implements LlmProvider {
  constructor(
    private readonly registry: HostLlmRegistry,
    private readonly fallback?: LlmProvider,
  ) {}

  async generate(request: GenerateRequest): Promise<RuntimeValue> {
    const model = request.model;
    if (!model || uriScheme(model.uri) !== "host") {
      if (this.fallback) return this.fallback.generate(request);
      throw new RuntimeError(`Host LLM provider cannot handle non-host model '${model?.uri}'`);
    }
    const key = hostRegistryKey(model.uri);
    const handler = this.registry[key];
    if (!handler) {
      throw new RuntimeError(`Unknown host llm '${key}' for ${model.uri}`);
    }

    let raw: unknown;
    try {
      raw = await handler(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(`Host llm '${key}' failed: ${message}`);
    }

    return fromHostValue(raw, { label: `host llm '${key}' result` });
  }
}
```

说明：

- 如果宿主同时传入 `hostLlms` 和 `llmProvider`：interpreter 构造一个 composite provider，该 provider 先判断 request.model URI 是否是 `host://`：是则走 `HostLlmProvider`，否则走 fallback。见阶段 6。
- host handler 返回值仍然走现有 `generate.ts` 中的 shape 校验 / coercion 逻辑，因为 `LlmProvider.generate` 的返回值是在 interpreter 下游再验证的。

验收：

- `model` 为 `host://fast` 时调用对应 handler。
- handler 异常被翻译为 `RuntimeError`。
- 非 host URI 直接回落到 fallback provider。

## 阶段 5：HostMemoryProvider

状态：计划中。

新增模块：

```text
src/providers/host/memory.ts
```

实现：

```ts
export class HostMemoryProvider implements MemoryProvider {
  constructor(
    private readonly registry: HostMemoryRegistry,
    private readonly fallback: MemoryProvider,
    private readonly signal: AbortSignal,
  ) {}

  async add(request: MemoryAddRequest): Promise<RuntimeValue> {
    if (uriScheme(request.uri) !== "host") return this.fallback.add(request);
    const impl = this.requireImpl(request.uri);
    const record = requireJsonObject(request.record, `memory.add record`);
    const raw = await impl.add(record, this.context(request.uri));
    return fromHostValue(raw, { label: "host memory add result" });
  }

  async query(request: MemoryQueryRequest): Promise<RuntimeValue> {
    if (uriScheme(request.uri) !== "host") return this.fallback.query(request);
    const impl = this.requireImpl(request.uri);
    const query = requireJsonObject(request.query, `memory.query argument`);
    const raw = await impl.query(query, this.context(request.uri));
    return fromHostValue(raw, { label: "host memory query result" });
  }

  private requireImpl(uri: string): HostMemoryImpl { /* ... */ }
  private context(uri: string): HostMemoryContext { /* ... */ }
}
```

说明：

- `add` 和 `query` 都 marshal/反向 marshal。
- record 和 query 必须是 object；拒绝 list 或 primitive。
- trace 与既有 memory kind 一致。
- 不自动补 `id`、`created_at`：v2 的 file/sqlite 后端是内建语义；host 由宿主负责。这与 v5-design 一致。

验收：

- 调用 `Lessons.add({...})` 会走 host handler。
- host handler 抛异常被包装成 `RuntimeError`，消息带 memory 名和 URI。
- 非 host URI 透传到 fallback（file / sqlite）。

## 阶段 6：接入 Interpreter 的 ExecuteOptions

状态：计划中。

修改：

```text
src/runtime/interpreter.ts
src/runtime/types.ts（视需要）
src/index.ts
```

实现项：

- 扩展 `ExecuteOptions`：新增 `hostTools`、`hostLlms`、`hostMemories`、`signal`。
- Interpreter 构造函数里：
  - 构造 `const signal = options.signal ?? neverAbortSignal`；抽一个 `neverAbortSignal()` 小工具（用 `new AbortController().signal`，不 abort）。
  - 如果传入 `hostTools` 非空：用 `HostToolProvider` 构造一个 scheme-`host` provider，并合并到最终 tool provider。
    - 默认情况：`createDefaultToolProvider(...)` 返回 `SchemeToolProvider`，其 providers map 里加 `host: hostToolProvider`；为了不改 `createDefaultToolProvider` 的签名，interpreter 可以单独用一个 wrapper：
      ```ts
      const baseToolProvider = options.toolProvider ?? createDefaultToolProvider(options.workspaceRoot);
      const toolProvider = hostTools
        ? composeToolProviderWithHost(baseToolProvider, new HostToolProvider(hostTools, signal))
        : baseToolProvider;
      ```
    - `composeToolProviderWithHost` 实现：按 URI scheme 判断，`host` 走 host provider，其它走 base。其 `close` 需 best-effort 透传。
  - 类似地处理 `hostLlms`：
    ```ts
    const llmProvider = options.hostLlms
      ? new HostLlmProvider(options.hostLlms, options.llmProvider ?? new MockLlmProvider())
      : options.llmProvider ?? new MockLlmProvider();
    ```
  - 类似地处理 `hostMemories`：
    ```ts
    const defaultMemory = createDefaultMemoryProvider({ ... });
    const memoryProvider = options.hostMemories
      ? new HostMemoryProvider(options.hostMemories, options.memoryProvider ?? defaultMemory, signal)
      : options.memoryProvider ?? defaultMemory;
    ```
- signal：Phase 1 不主动 wire 到现有 tool providers，只透传给 host providers；这保持最小侵入。
- Disposable：HostToolProvider 不持有外部资源，不需要实现 `close`；但 `composeToolProviderWithHost` 的 `close` 应转发给 base（沿用 `isDisposable` 判断）。

验收：

- 非 host 程序行为完全不变。
- 只传 `hostTools` 程序运行时能正确分派。
- `hostLlms` 单独使用时 `--mock` 被替换（注意顺序：`--mock` 是 CLI 层传入 `MockLlmProvider` 作为 `options.llmProvider`；若同时传 host，host 会绕过 mock，这是期望行为，因为显式 host 优先）。
- disposal 不泄漏 process。

## 阶段 7：Semantic 与 parallel-for 边界

状态：计划中。

目标：

- `import tool X from "host://..."` 现有 import 语义已可用，无需语法改动。
- 与 V3 MCP 类似，`parallel for` body 内的 host tool method call 应被 semantic 阶段视为 effectful 并拒绝。
- host llm、host memory 在 `parallel for` body 中不会出现（generate 已禁止，memory 在并行 body 中原本就受限），但如果需要，给出统一诊断。

实现提示：

- semantic scope 已经能解析 `imported` binding 并知道其 URI（`importBindings` 的 value 中带 `uri`，见 `analyzer.ts`）。
- 在 `checkParallelForBodyRules` 中新增规则：对 imported `tool` binding 使用成员调用时，如果 URI scheme 是 `host` 或 `mcp` 或 `sh`（已视为 effectful 的），报 effectful 错误；如果这段规则已经按 URI scheme 分类过，把 `host` 加入效果列表即可。

验收：

- 普通函数中 host tool call 通过 check。
- parallel for body 中 `Search.web_search({...})` 被 check 报错，消息提示 host tool 默认视为 effectful。

## 阶段 8：Trace 与错误

状态：计划中。

实现项：

- `uriScheme("host://...")` 已经返回 `host`，现有 evaluator 的 tool trace 事件已经填 `scheme: "host"`。无需改动。
- host 相关错误消息统一由 provider 层抛出，errors 模块不新增分支。
- 对 marshal 错误，Phase 1 可以沿用 `RuntimeError`；长期看可以加专门的 `HostError` 类，但 Phase 1 不需要（消息里已包含 host 上下文）。

验收：

- `--trace` 能看到 `scheme: "host"` 的 tool 调用。
- `--trace` 在 host llm 路径下的 `generate` 事件 identity 里展示 `model.uri` 为 `host://...`。

## 阶段 9：测试计划

状态：计划中。

不依赖任何外部服务。所有测试都在 TS 进程内完成。

新增测试文件：

```text
tests/host-tool.test.ts
tests/host-llm.test.ts
tests/host-memory.test.ts
tests/host-marshal.test.ts
```

覆盖点：

- marshal：
  - 纯 JSON 数据来回 round-trip。
  - `undefined`、Symbol、函数、BigInt、循环引用全部被拒绝。
  - binding 值作为 arg 被拒绝（用一个传 `Search`/`Qwen` 作为参数的 `.as` fixture 触发）。
  - 路径报错准确到字段。
- host tool：
  - 正常 call 返回值进入 `use` 流程。
  - 未注册 tool / 未注册 method 报错。
  - handler 抛异常被翻译。
  - AbortSignal 被正确传递（触发一个 handler 等待 signal 触发）。
  - parallel-for body 内拒绝 host tool call（semantic check 报错）。
- host llm：
  - `model Fast` + `host://fast` 注册后 generate 返回 handler 的输出，且输出经过 shape 校验。
  - 未注册 host llm 报错。
  - fallback 行为：非 host model 继续走 `MockLlmProvider`。
  - handler 返回非 JSON 被拒绝（会触发 fromHostValue 错误）。
- host memory：
  - add/query 正常路径。
  - 非 object record 被拒绝。
  - fallback：非 host URI 透传到默认 memory provider。

fixture 建议：

```text
tests/fixtures/host-tool.as
tests/fixtures/host-llm.as
tests/fixtures/host-memory.as
```

内容为最小可运行的 agent 程序。

## 阶段 10：文档最小更新

状态：计划中。

- 不新增语言文档（`docs/en/language.md` 和 `docs/cn/language.md` 不需要新增章节，因为语法未变）。可以在 tool URI scheme 表中追加一行 `host://`，标注为宿主注入的 tool。
- 新增 `docs/en/host-interop.md` 与 `docs/cn/host-interop.md` 一页简短介绍：适用对象、最小示例、三种 registry 的样板代码、边界限制。
- README 追加一节"Embed in TypeScript"，指向上面的新文档。
- CHANGELOG 增加 V5 条目。

## 阶段 11：示例

状态：计划中。

新增示例文件：

```text
examples/host-tool.as
examples/host-llm.as
examples/host-memory.as
```

搭配 TS 示例脚本：

```text
examples/host/embed.ts
```

`embed.ts` 演示：

- 用 `loadProgramSource` 读 `.as` 文件。
- 用 `executeAgent` 执行。
- 注入 `hostTools`、`hostLlms`、`hostMemories`。
- 打印 value 和 trace。

注意：examples 下的 `.as` 可以独立运行（走 mock），也能被 `embed.ts` 用 host registry 运行，两种模式都能跑。这与现有 examples 风格一致。

## 实施顺序建议

推荐顺序：

1. 类型与公共 API 表面（阶段 1）。
2. Marshal 工具（阶段 2）。
3. HostToolProvider（阶段 3）。
4. HostLlmProvider（阶段 4）。
5. HostMemoryProvider（阶段 5）。
6. ExecuteOptions wire-up（阶段 6）。
7. Semantic parallel-for 限制（阶段 7）。
8. Trace/错误细化（阶段 8）。
9. 测试（阶段 9）。
10. 文档与示例（阶段 10、11）。

原因：

- 类型定义先行，让所有后续代码用上相同 shape。
- marshal 是 tool/llm/memory 三者共享的基础模块。
- tool 最先落地，因为它是宿主接入最高频用例。
- llm 和 memory 依赖相同模式。
- wire-up 在最后做，避免中途反复修改 interpreter 构造。
- semantic 限制独立于 runtime，可并行推进。

## 风险与取舍

### 与 mock provider 的优先级

风险：`--mock` 和 `hostLlms` 同时出现时语义不直观。

Phase 1 处理：

- `hostLlms` 一旦提供，`host://...` 模型就走 host handler；其它 URI 走 `options.llmProvider`（CLI 层可能是 MockLlmProvider）。
- 如果 `.as` 程序用 `host://fast` 但宿主在 `--mock` 上下文下没有注册 host handler，会报 `Unknown host llm 'fast'`。这鼓励宿主在测试路径注入 mock handler。

### marshal 拒绝策略

风险：TS 侧 handler 无意中返回含 `undefined` 的 object 会被拒绝，提示开销大。

Phase 1 处理：

- 明确在文档中说明"host handler 必须返回 JSON-safe 值"。
- 在 marshal 错误 message 中包含精确路径，降低调试成本。
- 未来可选提供 `sanitizeUndefined: true` 等宽松 flag，但 Phase 1 保持严格。

### AbortSignal 的半完成状态

风险：Phase 1 只把 signal 传给 host provider，其它 provider（http、sh、mcp）仍不受 signal 控制。

Phase 1 处理：

- 明确文档说"signal 目前仅传递给 host provider；全链路 cancel 在后续版本补齐"。
- 不为此阻塞发布。

### Host 替换 LLM provider 的组合复杂度

风险：`hostLlms` 与 `llmProvider` 的合并规则不够直观。

Phase 1 处理：

- composite 里硬编码规则：`host://` scheme 走 host handler，其它走 fallback。
- 文档明确这条规则，并推荐宿主**只**传 `hostLlms`（把 protocol provider 通过 `llmProvider` 显式关掉或忽略）。
- 同一个 AgentScript 程序里同时需要 `openai://` 和 `host://` 时，提示宿主组合 `ProtocolLlmProvider` + `hostLlms`。

### parallel-for 的 effectful 列表膨胀

风险：未来每增一个 scheme 都要在 semantic 里维护列表。

Phase 1 处理：

- 设计成数据驱动：scheme 列表存在一个常量 `EFFECTFUL_TOOL_SCHEMES`，加上 `mcp`、`host`、`sh` 等。
- 新增 scheme 只改常量，不改其余 semantic 规则。

### zero dependency 承诺

风险：marshal / signal / composite 如果用方便库会让 dependency 膨胀。

Phase 1 处理：

- 全部用内置 API：`AbortController`、`WeakSet`、普通 `Object.prototype.toString`。
- 测试里不引入新 dep；`vitest` 已存在于 devDependencies。

## 完成标准

V5 Phase 1 完成时应满足：

- `import tool X from "host://name"` 可在 TS 宿主中运行。
- `import llm X from "host://name"` 可在 TS 宿主中运行。
- `import memory X from "host://name"` 可在 TS 宿主中运行。
- `executeAgent` 的 `ExecuteOptions` 新增 `hostTools`、`hostLlms`、`hostMemories`、`signal`。
- marshal 对非法值和 binding 值都能给出带路径的错误。
- trace 中 host 调用的 scheme 正确展示为 `host`。
- `parallel for` body 禁止 host tool call，semantic check 报错清晰。
- `--check` 不触发 host 回调。
- `--dry-run` 不触发 host 回调。
- 不新增 runtime dependency。
- `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build` 全部通过。
- README 和 `docs/**/host-interop.md` 反映上述能力，examples 含至少一个 host tool 示例。
