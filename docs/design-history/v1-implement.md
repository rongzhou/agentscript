# AgentScript V1 实施计划

本文档描述 V1 的分阶段实施方案。V1 设计见 `v1-design.md`。

V1 的实现目标是支持更多 Agent 模式，尤其是 Plan-and-Execute、Evaluator-Optimizer 和多 Agent 组合，同时保持语言小而清晰。

## 原则

- 先实现普通数据和模块能力，再考虑新控制流。
- 不引入模式专用关键词。
- 不实现通用并行语法。
- 不实现通用事务系统。
- Shell / IO 工具必须具体、可审计、可授权。

## 阶段 1：Plan-and-Execute 示例

状态：已完成。

目标：先用 V0 现有能力写出 Plan-and-Execute 示例，确认真实痛点。

产物：

- `tutorials/plan-execute.as`
- Planner、Executor、Verifier 作为普通 Agent 或普通函数。
- 顺序执行 plan steps。
- verifier 失败时调用 planner 重新规划。

验收：

- 示例能 parse/check/execute。
- trace 能看出 plan、step、verify、replan 的执行边界。

## 阶段 2：List 遍历

状态：已完成。

新增语法：

```agentscript
for item in list < n {
    ...
}
```

实现项：

- AST 增加 `ForInStmt`。
- parser 支持 `for item in expr < n { ... }`。
- semantic analyzer 检查 item 作用域和 iterable 表达式。
- runtime 校验 iterable 是 list，顺序遍历，`< n` 作为硬上限。
- trace 可选记录 iteration。

约束：

- `for` 每次迭代创建子作用域。
- list 在循环开始时求值一次。
- 外层已存在变量可以被更新。

## 阶段 3：List / JSON 能力增强

状态：已完成。

补齐 Plan-and-Execute 后续可能需要的集合能力。当前已支持 `list.length`、`list.add(value)`、`list.summary` 和 `for item in list < n`。

新增语法：

```agentscript
item = list[0]
value = list[index].field
```

实现项：

- parser 支持 `expr[expr]` postfix 表达式。
- semantic analyzer 检查 list 和 index 两侧表达式。
- runtime 支持 list item 读取。
- 越界读取抛出运行时错误。
- 非 list 或非非负整数 index 报运行时错误。

约束：

- 只支持读取，不支持 `list[0] = value`。
- 不支持切片。
- 不新增专用 JSON 操作关键词。

## 阶段 4：File Import

状态：已完成。

新增资源类型：

```agentscript
import file Requirements from "./requirements.md"
import file ApiSpec      from "./openapi.json"
```

实现项：

- AST 扩展 `ImportResourceKind` 支持 `file`。
- parser 支持 `import file`。
- semantic analyzer 把 file 作为资源绑定。
- runtime 加载相对当前 `.as` 文件的文件内容。
- `use FileName < n` 将文件内容加入 context。

约束：

- 文件默认不进入 prompt，必须显式 `use`。
- 文本文件作为 string。
- JSON 文件可作为 json。
- 路径解析和访问范围由 host runtime 控制。
- CLI 执行时相对路径基于当前 `.as` 文件目录解析。
- REPL 中相对路径基于当前工作目录解析。

## 阶段 5：Agent Import

状态：已完成。

新增资源类型：

```agentscript
import agent Planner from "./agents/planner.as"
```

实现项：

- parser 支持 `import agent`。
- loader 解析跨文件依赖图。
- semantic analyzer 合并导入 Agent 的符号。
- runtime 允许调用导入 Agent。
- trace 继续嵌套跨 Agent 调用。

约束：

- `import agent Name from "./x.as"` 只导入文件中名为 `Name` 的 Agent。
- 导入 Agent 不自动成为入口。
- 当前程序仍然只能有一个 `main agent`。
- V1 初期不支持 wildcard import 和 alias。
- CLI 使用 loader 执行、检查和解析入口文件。

## 阶段 6：Tool URI Provider

状态：已完成。

扩展 tool provider 分发：

- `mcp://...`
- `sh://具体命令`
- `file://workspace`
- `env://process`
- `http://...`
- `https://...`

实现项：

- 根据 URI scheme 选择 provider。
- `ToolProvider` 可拆分为 registry。
- trace 记录 provider scheme。
- 错误消息包含 tool 名称、method 和 URI。

约束：

- 本阶段只实现分发框架，不实现具体 shell/io/http 工具。
- 未注册 scheme 默认进入 fallback provider。

## 阶段 7：具体 Shell / IO 工具

状态：已完成。

推荐先实现：

- `sh://find`
- `sh://grep`
- `sh://sed`
- `file://workspace`
- `env://process`

已实现：

- `Find.run({ path, name, type, max })`
- `Grep.run({ path, pattern, include, max })`
- `Sed.run({ path, start, max })`
- `File.read({ path })`
- `File.list({ path })`
- `File.write({ path, content })`
- `File.undo(effects)`
- `Env.get({ name })`
- `Http.get({ url, headers, timeout })`
- `Http.post({ url, headers, body, timeout })`

禁止：

- `sh://sh`
- `sh://bash`
- `sh://zsh`
- `sh://fish`
- 任意命令字符串入口。

约束：

- 参数必须是结构化 JSON。
- 每个工具必须有超时和输出上限。
- 文件写入必须限制在 workspace。
- 有副作用的工具必须返回 effect record。
- `sh://sh`、`sh://bash` 等通用 shell 入口在 host provider 中被拒绝。

## 阶段 8：Effect Record 和 Compensation

状态：已完成。

目标：支持可审计补偿，不做语言级 rollback。

推荐 effect record：

```json
{
  "id": "effect-123",
  "tool": "File",
  "action": "write",
  "undoable": true
}
```

实现项：

- File write/patch 返回 effects。
- 允许 `File.undo(effects)`。
- trace 记录 effects。
- 示例中用普通函数 `compensate(result)` 表达补偿。

约束：

- 语言不新增 `rollback` 关键词。
- effect record 是普通 JSON，由工具返回。
- compensation 是普通函数调用，例如 `File.undo(result.effects)`。

## 阶段 9：Trace 增强

状态：已完成。

增强内容：

- for iteration。
- step id。
- agent call tree。
- tool effects。
- replan 原因。

已实现：

- agent call tree。
- for iteration。
- tool scheme、URI 和 effects。

要求：

- trace 不进入 prompt。
- pretty trace 保持可读。
- JSON trace 保持可机器处理。

## V1 完成标准

- 能用多个文件组织 Planner、Executor、Verifier。
- 能引用本地文件作为受预算控制的上下文。
- 能用具体 `sh://...`、File、Env、Http 工具完成有限任务。
- 能用 effect record + compensation 表达可审计补偿。
- 能用 `for item in list < n` 顺序执行 plan steps。
- 不引入 `planner`、`executor`、`verifier`、`rollback`、`parallel` 等模式关键词。
