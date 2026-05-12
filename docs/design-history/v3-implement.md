# AgentScript V3 实施计划

本文档描述 V3 Phase 1 的实施方案。V3 设计见 `v3-design.md`。

V3 Phase 1 的实现目标是支持 MCP stdio tools。它不改变 AgentScript 语言语法，不引入 runtime dependency，不支持 Streamable HTTP、resources、prompts、sampling 或 elicitation。

## 原则

- MCP 是 tool provider，不是语言特性。
- `import tool X from "mcp://..."` 复用现有 tool import 语义。
- MCP tool 返回值是普通 `RuntimeValue`，不会自动进入 prompt。
- 只支持 stdio transport。
- 不引入 `@modelcontextprotocol/sdk`。
- `agentscript --check` 默认不启动 MCP server。
- runtime error 必须明确包含 tool name、URI 和 MCP tool name。
- trace 继续使用现有 `tool` event。

## 阶段 1：Registry 配置加载

状态：计划中。

新增配置文件：

```json
{
  "mcpServers": {
    "search": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server-search"],
      "env": {
        "SEARCH_API_KEY": "$SEARCH_API_KEY"
      }
    }
  }
}
```

第一版默认位置：

```text
agentscript.mcp.json
```

路径基于 workspace root。

实现项：

- 新增 `src/providers/tools/mcp-config.ts`。
- 定义 `McpRegistry`、`McpServerConfig` 类型。
- 从 workspace root 读取 `agentscript.mcp.json`。
- 文件不存在时返回空 registry。
- 校验：
  - 顶层必须是 object。
  - `mcpServers` 必须是 object。
  - server key 必须是 string。
  - `transport` 必须是 `stdio`。
  - `command` 必须是 non-empty string。
  - `args` 可选，必须是 string array。
  - `env` 可选，必须是 string map。
- env value 支持 `$NAME` 展开。
- 不在错误信息中输出 env value。

推荐类型：

```ts
interface McpRegistry {
  mcpServers: Record<string, McpServerConfig>;
}

interface McpServerConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}
```

验收：

- 缺失 config 时，`mcp://missing` 报找不到 MCP server。
- malformed config 有明确错误。
- `$ENV_NAME` 能从 `process.env` 展开。
- secret value 不出现在错误和 trace 中。

## 阶段 2：最小 JSON-RPC Client

状态：计划中。

新增模块：

```text
src/providers/tools/mcp-rpc.ts
```

实现 JSON-RPC 2.0 over stdio。

实现项：

- 使用 `child_process.spawn` 启动 server。
- 使用 `readline.createInterface({ input: child.stdout })` 按行读取 stdout。
- stderr 可收集最近若干行，用于错误信息。
- 每个 request 分配递增 id。
- `pending` map 管理 id 到 Promise resolver。
- response 按 id resolve/reject。
- notification 可忽略。
- parse error 导致相关 client 进入 failed 状态。
- request timeout。
- `close()` 终止子进程并清空 pending。

推荐接口：

```ts
interface JsonRpcClient {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  close(): Promise<void>;
}
```

JSON-RPC request：

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

JSON-RPC response：

```json
{"jsonrpc":"2.0","id":1,"result":{}}
```

错误处理：

- response `error` 转为 `RuntimeError`。
- process spawn error 转为 `RuntimeError`。
- process exit 时 reject 所有 pending request。
- timeout 后 reject 当前 request。

验收：

- fake stdio server 能收到 request 并返回 response。
- 并发两个 request 能按 id 正确匹配。
- error response 能变成清晰 runtime error。
- timeout 能中止 request。
- `close()` 能结束子进程。

## 阶段 3：MCP Client 封装

状态：计划中。

新增模块：

```text
src/providers/tools/mcp-client.ts
```

职责：在 JSON-RPC client 之上实现 MCP 初始化和 tool 调用。

实现项：

- `initialize()`：发送 MCP `initialize`。
- 发送 `notifications/initialized`。
- `listTools()`：调用 `tools/list` 并缓存结果。
- `callTool(name, args)`：调用 `tools/call`。
- `close()`：关闭底层 JSON-RPC client。

推荐 initialize request：

```json
{
  "protocolVersion": "2025-03-26",
  "capabilities": {},
  "clientInfo": {
    "name": "agentscript",
    "version": "unknown"
  }
}
```

注意：

- protocolVersion 可集中成常量。
- 如果 server 返回不同 protocolVersion，Phase 1 可以接受，只要初始化成功。
- `tools/list` 结果必须校验为 object。
- tool list 中每个 tool 至少应有 string `name`。

推荐类型：

```ts
interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: RuntimeValue;
}

interface McpCallResult {
  content?: RuntimeValue;
  structuredContent?: RuntimeValue;
  isError?: boolean;
}
```

验收：

- 初始化顺序正确：`initialize` -> `notifications/initialized` -> `tools/list`。
- tool list 缓存，不重复 list。
- unknown tool 调用前可报错。
- MCP error response 原样进入错误消息摘要。

## 阶段 4：McpToolProvider

状态：计划中。

新增模块：

```text
src/providers/tools/mcp.ts
```

实现现有接口：

```ts
class McpToolProvider implements ToolProvider {
  call(request: ToolCallRequest): Promise<RuntimeValue>;
}
```

职责：

- 根据 `request.uri` 解析 registry key。
- 懒加载或复用对应 `McpClient`。
- 将 AgentScript method 映射到 MCP tool name。
- 规范化 MCP result 为 `RuntimeValue`。

URI 解析：

- `mcp://search` -> `search`。
- `mcp://tools/github` -> `tools/github`。
- 空 key 报错。

调用映射：

Direct method：

```agentscript
Search.web_search({ query: "x" })
```

映射：

```json
{
  "name": "web_search",
  "arguments": { "query": "x" }
}
```

Generic method：

```agentscript
Search.call({
    tool: "web-search",
    args: { "query": "x" }
})
```

映射：

```json
{
  "name": "web-search",
  "arguments": { "query": "x" }
}
```

参数规则：

- direct method：允许 0 或 1 个参数。
- direct method 0 参数：arguments 为 `{}`。
- direct method 1 参数：必须是 object。
- direct method 多参数：runtime error。
- generic `call`：必须 1 个 object 参数。
- generic `call.tool` 必须是 string。
- generic `call.args` 可选，缺省 `{}`，存在时必须是 object。

返回规范化：

```ts
function normalizeMcpResult(result: RuntimeValue): RuntimeValue {
  return {
    ok: !isError,
    text,
    content,
    structured,
    isError,
  };
}
```

规则：

- `content` 缺省 `[]`。
- `text` 拼接 content 中所有 `{ type: "text", text: string }`。
- `structured` 来自 `structuredContent`，缺省 `null`。
- `ok` 为 `!isError`。
- 非 object result 报错。

验收：

- `Tool.call({ tool, args })` 可调用包含短横线的 MCP tool。
- `Tool.foo({ ... })` 可调用合法 identifier tool。
- unknown tool 有明确错误，并列出可用 tools。
- result.text 可直接用于 `use result.text max 4k`。

## 阶段 5：接入 HostToolProvider

状态：计划中。

修改：

```text
src/providers/tools/host.ts
```

实现项：

- 创建 `McpToolProvider`。
- 在 `providers` 中加入 `mcp`。
- `createDefaultToolProvider(workspaceRoot)` 将 workspace root 传给 MCP provider。
- 确保 trace 中 scheme 仍显示 `mcp`。

示意：

```ts
this.providers = {
  env: new EnvToolProvider(),
  file: new FileToolProvider(workspace),
  http,
  https: http,
  mcp: new McpToolProvider(workspaceRoot),
  sh: new ShellToolProvider(workspace),
};
```

验收：

- `import tool Search from "mcp://search"` runtime 能分发到 MCP provider。
- 未配置 `mcp://search` 报 `MCP server 'search' not found`。
- 非 MCP 工具行为不变。

## 阶段 6：Provider Cleanup

状态：计划中。

当前问题：`ToolProvider` 只有 `call`，没有关闭生命周期。MCP stdio server 是长生命周期子进程，需要在 execution 结束后关闭。

推荐新增可选接口：

```ts
export interface DisposableProvider {
  close(): Promise<void>;
}

export function isDisposableProvider(value: unknown): value is DisposableProvider;
```

实现项：

- `McpToolProvider.close()` 关闭所有 client。
- `HostToolProvider.close()` 关闭所有支持 close 的 child provider。
- `SchemeToolProvider.close()` 关闭所有支持 close 的 provider，避免重复关闭同一 provider。
- `Interpreter.execute()` 使用 `try/finally` 在运行结束后关闭 provider。
- REPL 如果复用 provider，需要决定每次 run 后关闭，还是 REPL 退出时关闭。Phase 1 可以每次 execution 后关闭。

验收：

- 执行结束后 fake MCP server 进程退出。
- tool 调用失败时仍执行 cleanup。
- 非 disposable provider 不受影响。

## 阶段 7：Semantic 与 parallel-for 边界

状态：计划中。

语义检查策略：

- 不新增 parser/AST。
- `import tool` 已存在，无需改语法。
- semantic 不连接 MCP server。
- `Tool.anyMethod(...)` 仍按普通 tool method call 处理。
- unknown MCP tool method 在 runtime 报错。

parallel-for 安全策略：

当前 semantic 对 parallel-for 中有副作用的 tool method 有保守规则。MCP tool 是否有副作用无法静态知道。

Phase 1 推荐：

- `mcp://...` tool 在 `parallel for` 中默认视为 effectful。
- 如果现有 semantic 无法基于 URI 判断，则先在 runtime provider 层保证并发安全，同时在后续 semantic refactor 中补上。
- 更严格方案：semantic 中对 imported tool URI scheme 为 `mcp` 的 member call 在 parallel-for body 内报错。

推荐实施：

1. 先检查当前 semantic 是否能访问 import URI。
2. 如果能访问，添加规则：parallel-for body 禁止 MCP tool call。
3. 如果需要较大改动，Phase 1 可以暂缓，但必须在文档和测试中记录风险。

验收：

- 普通函数中 MCP tool call 可通过 semantic check。
- 如果实现严格规则，parallel-for 中 MCP tool call 被拒绝，并提示 MCP tool 默认视为 effectful。

## 阶段 8：CLI 与示例

状态：计划中。

Phase 1 可以不新增 CLI 参数。

默认行为：

- CLI run 使用 workspace root 下的 `agentscript.mcp.json`。
- `--check` 不读取或启动 MCP server。
- `--dry-run` 不调用 MCP server，因为程序不执行。

新增示例：

```text
examples/mcp-echo.as
```

示例：

```agentscript
import tool Echo from "mcp://echo"

main agent McpEcho {
    main func(input { text: string }) {
        result = Echo.call({
            tool: "echo",
            args: {
                text: input.text
            }
        })

        return result.text
    }
}
```

测试用 config 可放在 fixture 或临时目录，不建议把真实 `agentscript.mcp.json` 写入项目根。

README 可后续增加短示例，但 Phase 1 先以 tests 和 design-history 为准。

## 阶段 9：测试计划

状态：计划中。

不依赖真实外部 MCP server。

新增 fixture：

```text
tests/fixtures/mcp-echo-server.mjs
```

行为：

- 从 stdin 逐行读取 JSON-RPC。
- 响应 `initialize`。
- 忽略 `notifications/initialized`。
- 响应 `tools/list`，返回 `echo` 和 `web-search` 两个 tool。
- 响应 `tools/call`。
- 对 unknown tool 返回 JSON-RPC error。

测试文件：

```text
tests/mcp.test.ts
```

覆盖：

- registry 读取和 validation。
- `mcp://echo` key 解析。
- initialize + initialized + tools/list 顺序。
- generic `call({ tool, args })`。
- direct method `Echo.echo({ text })`。
- tool name 包含短横线：`call({ tool: "web-search" })`。
- result normalization：`ok`、`text`、`content`、`structured`。
- unknown tool error。
- timeout error。
- process cleanup。
- trace 中 scheme 为 `mcp`。

推荐补充：

- `tests/examples.test.ts` 可暂不执行 MCP 示例，避免要求 fixture config。
- MCP 示例如加入 `examples/`，需要测试框架能注入临时 config；否则先放 `tests/fixtures/`。

## 阶段 10：文档最小更新

状态：计划中。

不写语言设计文档。V3 design-history 已覆盖设计。

实现后可最小更新：

- README / README-CN 增加一小段 MCP tool provider 示例。
- `docs/en/language.md` / `docs/cn/language.md` 只在 tool URI scheme 列表中提到 `mcp://`。
- 不把 MCP resources/prompts 写成 AgentScript 能力。

示例文案重点：

- MCP extends tools, not prompt context。
- tool result must still be selected with `use`。
- stdio only in current release。
- uses `agentscript.mcp.json`。

## 实施顺序建议

推荐顺序：

1. Registry parser and validation。
2. JSON-RPC stdio client。
3. MCP client initialize/list/call。
4. McpToolProvider mapping and result normalization。
5. HostToolProvider scheme integration。
6. Cleanup lifecycle。
7. Runtime tests with fake MCP server。
8. Semantic parallel-for restriction if low-risk。
9. Minimal README/language docs after behavior is stable。

原因：

- registry 和 JSON-RPC client 可以独立测试。
- MCP client 在没有 AgentScript runtime 的情况下也能测试。
- provider integration 最后做，降低调试范围。
- docs 应在 API 稳定后再写。

## 风险和取舍

### Zero dependency vs protocol drift

风险：手写 MCP client 需要跟进协议变化。

Phase 1 处理：

- 只支持 stdio。
- 只实现 initialize、tools/list、tools/call。
- 协议相关代码集中在 `mcp-rpc.ts` 和 `mcp-client.ts`。
- 后续支持 Streamable HTTP 时重新评估 SDK。

### Registry 执行本地命令

风险：MCP stdio 需要 spawn 本地进程。

Phase 1 处理：

- `.as` 源码只引用 `mcp://key`。
- command/args/env 在本地 registry 中，由运行者控制。
- 不把 env secret 写入 trace。
- 后续可加 `--allow-mcp` 或 trust prompt。

### Dynamic tool method

风险：semantic check 无法知道 MCP tool list。

Phase 1 处理：

- check 不连接 server。
- runtime 根据 `tools/list` 做 unknown tool 校验。
- 未来可加 `--resolve-mcp`。

### parallel-for 副作用

风险：MCP tool 可能有副作用，无法静态判断。

Phase 1 处理：

- 默认按 effectful 对待。
- 优先在 semantic 中禁止 parallel-for body 调用 MCP tool。
- 后续通过 registry policy 显式标注 read-only 后再允许。

### Result 过大

风险：MCP server 返回大 content，trace 和 prompt 可能膨胀。

Phase 1 处理：

- result 仍是普通数据，不自动进入 prompt。
- prompt 侧由 `use ... max ...` 控制。
- trace 先沿用现有 sanitize；后续可做 truncation。

## 完成标准

V3 Phase 1 完成时应满足：

- `import tool X from "mcp://key"` 可运行。
- workspace `agentscript.mcp.json` 可配置 stdio MCP server。
- runtime 能 initialize server、list tools、call tools。
- 支持 `X.call({ tool, args })`。
- 支持 `X.someTool(args)` direct method。
- MCP result 返回 `{ ok, text, content, structured, isError }`。
- trace 记录 MCP tool call，scheme 为 `mcp`。
- execution 结束后关闭 MCP 子进程。
- 不新增 runtime dependency。
- `npm run format:check`、`npm run typecheck`、`npm test`、`npm run build` 全部通过。
