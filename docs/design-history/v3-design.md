# AgentScript V3 Design

V3 的目标是在不改变 AgentScript 语言核心语义的前提下，支持 MCP tool。MCP 在 AgentScript 中不是新的语言特性，而是一种新的 `import tool` provider。

V3 第一阶段只做最小可用能力：stdio transport、tools/list、tools/call、zero runtime dependencies。Streamable HTTP、resources、prompts、sampling、elicitation 暂不进入范围。

`use`、scope 和 prompt context 的基础语义不变：MCP tool 返回值只是普通运行时数据，不会自动进入 prompt。只有被赋值并显式 `use` 后，才会进入后续 `generate`。

## 目标

V3 Phase 1 支持：

- `import tool X from "mcp://server"` 声明 MCP tool server。
- runtime 根据本地 registry 找到 `server` 对应的 stdio 启动配置。
- 首次调用时按需启动 MCP server 子进程。
- 完成 MCP 初始化握手：`initialize`、`initialized`。
- 获取并缓存 `tools/list`。
- 将 `X.someMethod({ ... })` 映射为 MCP `tools/call`。
- 将 MCP tool result 规范化为 AgentScript `RuntimeValue`。
- tool 调用写入现有 trace。
- 不引入第三方 runtime dependency。

V3 Phase 1 不支持：

- Streamable HTTP transport。
- 旧 HTTP+SSE transport。
- MCP resources。
- MCP prompts。
- MCP sampling。
- MCP elicitation。
- semantic 阶段连接 MCP server 做动态 method 校验。
- 自动把 MCP tool result 放入 prompt。
- MCP server 反向调用 AgentScript 的 LLM provider。

## 与语言的关系

AgentScript 语法不变：

```agentscript
import tool Search from "mcp://search"

main agent Researcher {
    main func(input { query: string }) {
        result = Search.web_search({
            query: input.query
        })

        use result.text max 4k as "search results"

        generate({
            input: "Answer from selected search results"
        }) -> {
            answer
            citations: list[string]
        }
    }
}
```

这里 `mcp://search` 只是 tool URI。parser、AST 和 import 语义不需要新增 resource kind。

MCP tool 返回值仍是普通数据：

```agentscript
result = Search.web_search({ query: input.query })
```

它不会自动进入 prompt。必须显式选择：

```agentscript
use result.text max 4k as "search results"
```

这保持 AgentScript 的核心不变式：工具扩展程序能做什么，`use` 控制模型能看什么。

## URI 语义

V3 Phase 1 采用 registry 语义：

```agentscript
import tool Search from "mcp://search"
```

含义：

- URI scheme `mcp` 选择 MCP tool provider。
- URI host/path 合成 registry key。
- registry key 指向一个本地 MCP server 配置。
- 具体 command、args、env 不写在 `.as` 源码里。

示例 registry：

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
    },
    "tools/github": {
      "transport": "stdio",
      "command": "node",
      "args": ["./tools/github-mcp-server.js"]
    }
  }
}
```

`mcp://search` 对应 key `search`。

`mcp://tools/github` 对应 key `tools/github`。

这样做的原因：

- `.as` 文件保留逻辑依赖，不泄露本地启动细节。
- command/args/env 更适合放在 JSON 配置中。
- 与 Claude Desktop、VSCode 等 MCP host 的 registry 风格接近。
- 避免把复杂命令行编码进 URI。

## Registry 位置

V3 Phase 1 推荐按顺序查找：

1. CLI 显式传入的 `--mcp-config path`。
2. workspace root 下的 `agentscript.mcp.json`。
3. 用户目录下的 `.agentscript/mcp.json`。

第一版可以先实现第 2 项，即 workspace root 下的 `agentscript.mcp.json`。CLI 参数和用户级配置可以作为后续增强。

registry 中只支持 `transport: "stdio"`。

如果配置缺失或 transport 不是 `stdio`，runtime 报明确错误。

## 为什么不引入 SDK

V3 Phase 1 不引入 `@modelcontextprotocol/sdk`。

原因：

- AgentScript 当前有 zero runtime dependencies，这是项目定位的一部分。
- Phase 1 只需要 MCP client 的很小子集。
- stdio transport 可以用 Node 内置模块实现：`child_process`、`readline`、`events`。
- JSON-RPC 2.0 请求/响应和 id 映射实现范围可控。
- Streamable HTTP 暂不支持，避免提前承担协议演进复杂度。

代价：

- 需要自己维护最小 MCP client。
- 协议升级时需要手动跟进。
- 后续如果支持 Streamable HTTP，应重新评估是否引入 SDK。

判断：Phase 1 的 zero-dependency stdio client 是合理折中。

## MCP 调用映射

AgentScript 成员调用：

```agentscript
Search.web_search({
    query: "agentscript"
})
```

映射为 MCP：

```json
{
  "method": "tools/call",
  "params": {
    "name": "web_search",
    "arguments": {
      "query": "agentscript"
    }
  }
}
```

规则：

- Host tool method name 直接作为 MCP tool name。
- 参数必须是 0 或 1 个。
- 如果有 1 个参数，必须是 JSON object。
- 如果有 0 个参数，arguments 使用 `{}`。
- 多参数调用在 runtime 报错。

MCP tool name 可能包含 `-`、`.`、`/` 等不是 AgentScript identifier 的字符。V3 Phase 1 可以同时支持通用入口：

```agentscript
Search.call({
    tool: "web-search",
    args: {
        query: input.query
    }
})
```

`call` 是 MCP provider 保留方法，映射为：

```json
{
  "method": "tools/call",
  "params": {
    "name": "web-search",
    "arguments": {
      "query": "..."
    }
  }
}
```

推荐规则：

- 先实现 `call({ tool, args })`，保证所有 MCP tool name 都可调用。
- 再实现 direct method shorthand。
- 如果 direct method 与保留方法冲突，`call` 优先作为 provider 保留方法。

## `tools/list` 和 method 校验

MCP provider 在初始化后调用 `tools/list` 并缓存结果。

用途：

- runtime 调用前检查 tool 是否存在。
- 错误消息可以列出可用 tool name。
- 未来可用于 CLI inspect 或动态 check。

V3 Phase 1 不在 semantic 阶段连接 MCP server。

原因：

- `agentscript --check` 应保持纯静态、快速、可离线。
- check 不应启动任意子进程。
- MCP server 可能依赖本地环境变量、网络或凭据。

未知 tool method 在 runtime 报错。

未来可以增加 opt-in：

```bash
agentscript --check --resolve-mcp program.as
```

但不属于 Phase 1。

## 返回值规范化

MCP `tools/call` 结果通常类似：

```json
{
  "content": [
    { "type": "text", "text": "..." }
  ],
  "isError": false,
  "structuredContent": {
    "items": []
  }
}
```

AgentScript 中统一返回：

```json
{
  "ok": true,
  "text": "...",
  "content": [
    { "type": "text", "text": "..." }
  ],
  "structured": {
    "items": []
  },
  "isError": false
}
```

规则：

- `ok` 为 `!isError`。
- `content` 保留 MCP 原始 content array，但必须 sanitize 成 JSON-compatible value。
- `text` 拼接所有 `type: "text"` content block，用换行连接。
- `structured` 来自 `structuredContent`，没有则为 `null`。
- `isError` 保留 MCP 原始布尔值。

不建议只返回 string，因为会丢失 image/resource/structured content。

## Trace

MCP tool 调用继续使用现有 `tool` trace kind。

推荐 trace data：

```json
{
  "kind": "tool",
  "data": {
    "tool": "Search",
    "method": "web_search",
    "scheme": "mcp",
    "uri": "mcp://search",
    "args": [{ "query": "agentscript" }],
    "result": {
      "ok": true,
      "text": "...",
      "content": []
    },
    "effects": []
  }
}
```

MCP provider 不新增 trace kind。

注意：

- trace 不进入 prompt。
- args/result 使用现有 sanitize 逻辑。
- 不应在 trace 中展开 registry env secret。
- 如果 MCP result 很大，后续可以引入 trace truncation，但 Phase 1 可沿用现有机制。

## 生命周期

MCP server lifecycle：

- 按需启动：第一次调用某个 `mcp://key` 时 spawn。
- 每个 registry key 在一次 AgentScript execution 中复用一个 client。
- 初始化后缓存 `tools/list`。
- execution 结束时关闭所有 MCP client。
- 如果 server 进程提前退出，后续调用报 runtime error。

当前 `ToolProvider` 接口只有 `call`，没有 `close`。V3 可以采用两种实现：

1. 扩展默认 provider 内部，在进程 `beforeExit`/`exit` 做 best-effort cleanup。
2. 增加可选接口：

```ts
interface DisposableProvider {
  close(): Promise<void>;
}
```

并让 interpreter 在 execution 结束时调用。

推荐第 2 种，因为它更可测试，也更符合长进程 REPL 场景。

## 并发与 parallel-for

MCP provider 必须能处理并发 `call`。

最小规则：

- JSON-RPC request id 全局递增。
- pending requests 用 `Map<id, resolver>` 管理。
- stdout 每行解析为 JSON-RPC message。
- response 按 id 分发给对应 Promise。
- notification 可以忽略或记录 debug 信息。

`parallel for` 安全边界需要保守处理。

V3 Phase 1 推荐：

- MCP tool 默认视为 effectful。
- 在 `parallel for` 中调用 MCP tool 默认拒绝。
- 未来可通过 registry 中的 tool policy opt-in 标记 read-only。

示例未来扩展：

```json
{
  "mcpServers": {
    "search": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@example/search"],
      "tools": {
        "web_search": { "effect": "read" }
      }
    }
  }
}
```

Phase 1 可以先不实现 policy，只在设计上明确默认保守。

## 错误处理

必须有清晰 runtime error：

- registry file 不存在。
- `mcp://key` 找不到配置。
- transport 不是 `stdio`。
- command 缺失或不是 string。
- args 不是 string array。
- env 不是 string map。
- spawn 失败。
- initialize timeout。
- JSON-RPC parse error。
- MCP error response。
- unknown tool。
- `tools/call` 返回非 object。
- server process 提前退出。

错误消息应包含：

- AgentScript tool name。
- MCP URI。
- MCP method/tool name。
- 原始 MCP error code/message，如果有。

## 安全边界

MCP server 是外部程序，可能读写文件、访问网络或执行命令。

V3 Phase 1 的安全模型：

- 只有显式 `import tool X from "mcp://..."` 才会调用 MCP。
- `.as` 文件不携带 command/args/env，避免源码直接隐藏执行命令。
- command/args/env 来自本地 registry，由运行者控制。
- secrets 通过 env 传递，不写入 trace。
- registry env 支持 `$NAME` 展开，从当前 process env 读取。
- 不自动授权 MCP result 进入 prompt，仍需 `use`。

需要注意：

- 启动 MCP server 本身就是执行本地命令。
- CLI 后续可以考虑 `--allow-mcp` 或执行前确认，但 Phase 1 可先沿用显式 import + 本地 registry 的授权模型。

## 与 V1/V2 的关系

V1 已经把 `mcp://...` 预留为 tool URI scheme。V3 实现这个 provider。

V2 memory 与 MCP 无直接耦合：

- MCP tool 返回普通数据。
- 程序可以显式写入 memory。
- memory 查询结果仍需显式 `use` 才进入 prompt。

V3 不改变 parser、scope、generate、memory 或 agent composition 语义。

## 开放问题

Phase 1 需要先拍板：

- registry 文件名是否固定为 `agentscript.mcp.json`。
- 是否同时支持用户级 `~/.agentscript/mcp.json`。
- CLI 是否需要 `--mcp-config`。
- `parallel for` 中 MCP tool 是否一律拒绝，还是先允许 runtime 并发调用。
- 是否立即实现 `call({ tool, args })` 和 direct method 两种形式。

推荐默认：

- 先只支持 workspace `agentscript.mcp.json`。
- 先实现 `call({ tool, args })` 和 direct method。
- 先不做 semantic dynamic check。
- MCP 在 `parallel for` 中默认拒绝，后续用 registry policy 放开。
