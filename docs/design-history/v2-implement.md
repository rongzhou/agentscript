# AgentScript V2 实施计划

本文档描述 V2 的分阶段实施方案。V2 设计见 `v2-design.md`。

V2 的实现目标是新增 memory 资源能力，让 reflection、self-improvement 和保守 self-evolution 可以通过普通 AgentScript 模式组合出来。实现重点是可审计、可控、最小 API，而不是做通用数据库语言。

## 原则

- 不新增 `reflect`、`improve`、`evolve` 等模式关键词。
- Memory 作为资源绑定，不是普通 prompt context。
- Memory 查询结果是普通 JSON/list，必须显式 `use` 才进入 prompt。
- Memory 写入必须显式调用，不自动记录所有 trace 或局部变量。
- file 和 sqlite backend 使用同一 runtime 接口。
- 不支持任意 SQL。
- 不自动修改 `.as` 源码。

## 阶段 1：AST / Parser / Semantic

状态：已完成。

新增资源类型：

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import memory Runs    from "sqlite://./.agentscript/memory.db#runs"
```

实现项：

- AST 扩展 `ImportResourceKind`，增加 `memory`。
- tokenizer 不需要新增关键词以外的语法；`memory` 作为 import resource kind 处理。
- parser 支持 `import memory Name from "uri"`。
- semantic analyzer 把 memory 注册为资源绑定。
- `use MemoryName` 报错，和 `tool`、`llm`、`agent` 一样不能作为 prompt context。
- 函数调用检查支持 memory method call：
  - `Memory.add(record)`
  - `Memory.query(filter)`

约束：

- V2 只允许上述两个 method。
- `add` 参数数量必须为 1。
- `query` 参数数量必须为 1。
- `MemoryName(input)` 不合法；memory 不是 callable Agent。

验收：

- `import memory` 可以 parse/check。
- `use Lessons` 被 semantic analyzer 拒绝。
- 未知 memory method 被拒绝。
- memory method arity 错误被拒绝。

## 阶段 2：Runtime Binding 和 Provider 接口

状态：已完成。

新增 runtime 类型：

```ts
interface MemoryBinding {
  __agentScriptResource: "memory";
  name: string;
  uri: string;
}

interface MemoryProvider {
  add(request: MemoryAddRequest): Promise<RuntimeValue>;
  query(request: MemoryQueryRequest): Promise<RuntimeValue>;
}
```

推荐请求结构：

```ts
interface MemoryAddRequest {
  memoryName: string;
  uri: string;
  record: RuntimeValue;
}

interface MemoryQueryRequest {
  memoryName: string;
  uri: string;
  query: RuntimeValue;
}
```

实现项：

- `src/runtime/types.ts` 增加 memory binding 和 provider 类型。
- `src/runtime/guards.ts` 增加 `isMemoryBinding`。
- interpreter 加载 import memory，写入根作用域。
- evaluator 识别 `Memory.add(...)` 和 `Memory.query(...)`。
- 默认 runtime 创建 host memory provider。
- trace 增加 `memory` 事件类型。

约束：

- memory provider 返回值必须是 `RuntimeValue`。
- `add` 参数必须是 object，否则 runtime error。
- `query` 参数必须是 object，否则 runtime error。
- provider error 不做自动 retry。

验收：

- memory method 调用能进入 provider。
- trace 记录 memory name、operation、uri、args/result 摘要。
- memory binding 不能被 `use`。

## 阶段 3：File JSONL Memory

状态：已完成。

URI：

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
```

实现模块：

- `src/providers/memory/host.ts`：统一 memory provider 和 URI dispatch。
- file JSONL backend 在 `src/providers/memory/file.ts` 中实现，SQLite backend 在 `src/providers/memory/sqlite.ts` 中实现。

存储格式：

```json
{"id":"...","created_at":"...","updated_at":"...","record":{"kind":"lesson","text":"..."}}
```

实现项：

- 解析 `file://` URI。
- 相对路径基于入口 `.as` 文件目录；REPL 中基于当前工作目录。
- 路径必须限制在 workspace root 或 source 所在目录策略内。
- 文件不存在时自动创建。
- 父目录不存在时自动创建。
- `add(record)` 追加 JSONL。
- `query({ text, kind, where, limit })` 读取并过滤。

查询规则：

- `limit` 缺省建议为 `10`。
- `limit` 必须是正整数。
- `kind` 精确匹配 `record.kind`。
- `text` 对 `record.text` 和完整 record JSON 做大小写不敏感包含匹配。
- `where` 只匹配 record 顶层字段，使用 JSON stringify 后的精确相等。
- 默认按最近写入优先。

错误处理：

- 损坏 JSONL 行报 runtime error，并包含行号。
- 路径越界报 runtime error。
- 非 object record 或 query 报 runtime error。

验收：

- `Lessons.add({...})` 写入 JSONL。
- `Lessons.query({ limit: 5 })` 返回最近 5 条。
- `Lessons.query({ kind: "lesson", text: "agent" })` 可过滤。
- 损坏 JSONL 行有明确错误。

## 阶段 4：SQLite Memory

状态：已完成。

URI：

```agentscript
import memory Lessons from "sqlite://./.agentscript/memory.db#lessons"
```

依赖选择：

- 当前实现使用 Node.js 内置 `node:sqlite` 的 `DatabaseSync`。
- 不需要引入第三方 sqlite 依赖。

固定 schema：

```sql
CREATE TABLE IF NOT EXISTS memory_records (
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT,
  text TEXT,
  record_json TEXT NOT NULL,
  PRIMARY KEY (namespace, id)
);
```

实现项：

- 解析 `sqlite://` URI。
- path 指向数据库文件。
- fragment 作为 namespace；缺省为 `memory`。
- 初始化固定 schema。
- `add(record)` 写入 envelope。
- 从 record 顶层提取：
  - `kind`：string 时写入索引列。
  - `text`：string 时写入索引列。
- `query({ text, kind, where, limit })` 使用固定 SQL 构造。

查询规则：

- `kind` 使用等值查询。
- `text` V2 第一版使用 `LIKE`。
- `where` 可先在 SQL 初筛后用 JS 过滤 record 顶层字段。
- 默认按 `created_at DESC`。

安全约束：

- 不暴露任意 SQL。
- table 固定为 `memory_records`。
- namespace 来自 URI fragment，必须做标识符无关处理，只作为参数值绑定。
- 所有查询使用 prepared statement。
- path 访问遵守 host workspace 限制。

验收：

- sqlite 文件可自动创建。
- 同一 db 不同 namespace 相互隔离。
- query 结果与 file backend 语义一致。
- 不存在任意 SQL 注入入口。

## 阶段 5：Reflection / Self-Improvement 示例

状态：已完成。

新增教程：

- `tutorials/memory.as`：最小 memory add/query。
- `tutorials/self-improve.as`：读取 lesson、执行任务、reflect、写入 lesson。

示例应展示：

- `import memory`。
- `past = Lessons.query(...)`。
- `use past < 2k`。
- `generate({ input, limit, attempts })`。
- `Lessons.add(...)`。
- trace 中能看到 memory query/add。

验收：

- 示例可 `--check`。
- 使用 mock LLM/provider 时可执行。
- 本地运行后能看到 JSONL 或 sqlite 记录。

## 阶段 6：CLI / REPL 支持

状态：已完成。

CLI：

- 默认启用 file memory。
- sqlite memory 使用 Node.js 内置 `node:sqlite`。
- `--quiet` 只输出最终结果，不输出 memory trace。
- `--verbose` 输出 memory trace。

REPL：

- `:load` 后相对 memory path 基于加载文件目录。
- 直接粘贴 agent 时相对 memory path 基于当前工作目录。
- memory 文件不应被 REPL 自动清理。

可选开发命令：

```bash
npm run check -- tutorials/memory.as
npm run execute -- tutorials/memory.as --input '{"topic":"learn"}'
```

## Trace 设计

新增 trace kind：

```ts
type TraceEventKind = "use" | "generate" | "tool" | "input" | "agent" | "for" | "memory";
```

query trace：

```json
{
  "kind": "memory",
  "data": {
    "memory": "Lessons",
    "operation": "query",
    "uri": "file://./.agentscript/lessons.jsonl",
    "args": { "kind": "lesson", "limit": 5 },
    "count": 3
  }
}
```

add trace：

```json
{
  "kind": "memory",
  "data": {
    "memory": "Lessons",
    "operation": "add",
    "uri": "file://./.agentscript/lessons.jsonl",
    "id": "...",
    "record": { "kind": "lesson", "text": "..." }
  }
}
```

trace 注意事项：

- trace 可记录 record 摘要，但应避免无限大输出。
- 未来如需隐私控制，可增加 trace redaction。
- trace 不自动写入 memory。

## 测试计划

单元测试：

- parser：`import memory`。
- semantic：memory binding、method、arity、`use Memory`。
- runtime：provider dispatch、trace。
- file backend：add/query/filter/bad JSONL/path。
- sqlite backend：add/query/namespace/filter。

回归测试：

- `fixtures/v2.as` 覆盖 memory + self-improvement 最小流程。
- `tutorials/memory.as` 和 `tutorials/self-improve.as` 能 check。

命令：

```bash
npm run typecheck
npm test
npm run build
npm run check -- fixtures/v2.as
```

## 实施顺序建议

推荐顺序：

1. `import memory` 语义接入。
2. runtime memory provider 接口和 mock provider。
3. file JSONL backend。
4. trace。
5. 示例和 fixture。
6. sqlite backend。

原因：

- file backend 能最快验证语言语义。
- sqlite 使用 Node.js 内置 `node:sqlite`，不需要新增依赖，但仍应在接口稳定后接入。
- 示例应尽早驱动 API 是否自然。

## 风险和取舍

### Memory 污染

风险：Agent 把低质量 lesson 持久化，未来反复污染 prompt。

V2 处理：

- 写入必须显式。
- 示例中推荐 reflection 输出 `ok`、`confidence` 或 `kind`。
- 查询必须显式 `use`。

### 上下文膨胀

风险：query 返回太多历史记录。

V2 处理：

- `query` 支持 `limit`。
- `use past < 2k` 继续用 context budget 控制 prompt。

### 数据库能力过大

风险：任意 SQL 让语言变成数据库脚本，并增加安全风险。

V2 处理：

- sqlite backend 固定 schema。
- 不支持任意 SQL。
- 查询 API 只支持 `text`、`kind`、`where`、`limit`。

### Self-Evolution 过早扩大

风险：自动修改代码需要权限、回滚、测试、审计，超出 V2。

V2 处理：

- 只持久化 lesson/rule/profile。
- 不自动修改 `.as` 源码。
- patch proposal 只能作为普通数据返回。
