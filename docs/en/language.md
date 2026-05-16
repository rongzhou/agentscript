# AgentScript Language

This document describes AgentScript v0.1.x.

## Design principles

- Agent is the unit of execution and prompt identity.
- Context is explicit: ordinary variables, tool results, memory records, and trace events do not enter prompts unless selected with `use`.
- Scope controls variable lifetime, context inheritance, and prompt exposure.
- LLM, tool, memory, file, and agent imports are runtime capabilities with explicit boundaries.
- AgentScript keeps pattern names such as planner, executor, verifier, reflect, improve, and evolve as ordinary agent or function names.
- Trace is for debugging and audit; it is not prompt context.

## Related design documents

This language reference is the compact syntax and feature map. Detailed design documents cover:

- [`use ... as ...`](./use-as.md): prompt context selection, labels, budgets, scope visibility, deferred evaluation, and trace.
- [`generate`](./generate.md): generation sites, prompt construction, agent identity, output contracts, provider hints, validation, retries, and trace.
- [Label-only Contract Fields](./generate-default-string-fields.md): default-value shorthand for `generate` output contracts.
- [`parallel for`](./parallel-for.md): structured parallelism for independent bounded list work.
- [Final Expression Return](./final-expression-return.md): implicit return from the final top-level expression in a function body.
- [npm and node tools](./npm-tools.md): calling npm packages and Node built-in modules from AgentScript.
- [Optimizer Toolchain](./optimizer.md): `host://optimizer` tools for inspecting, trialing, and specializing `use one of` variants.
- [AgentSpec](./agent-spec.md): JSON blueprint format that compiles deterministically into AgentScript source.

## Program structure

A program contains imports and agents. Execution starts from the selected agent and function, or from the program's `main agent` and `main func`.

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"

main agent Assistant {
    model Qwen
    role "Assistant"
    description "Answer with structured JSON."

    main func(input {
        question: string
    }) {
        use input.question
        generate({ input: "Answer the question" }) -> {
            ok: boolean
            answer
        }
    }
}
```

## Imports

AgentScript supports five resource kinds:

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
import tool Find from "sh://find"
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import file Requirements from "./requirements.md"
import agent Worker from "./worker.as"
```

Resource bindings are explicit capabilities. `llm`, `tool`, `memory`, and `agent` bindings cannot be directly added to prompt context with `use`. File imports are read-only context resources and must still be explicitly used.

### LLM URIs

```agentscript
import llm Fast from "openai://gpt-4.1-mini"
import llm Strong from "anthropic://claude-sonnet-4-0"
import llm Local from "ollama://localhost:11434/qwen3.6"
```

Environment variables:
- `OPENAI_API_KEY` / `OPENAI_BASE_URL`
- `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
- `OLLAMA_BASE_URL`

### Tool URIs

Tools use URI schemes for dispatch:

| Scheme | Provider | Example |
|--------|----------|---------|
| `sh://` | Shell-based tools | `sh://find`, `sh://grep`, `sh://read-range` |
| `file://` | File operations | `file://workspace` |
| `env://` | Environment variables | `env://process` |
| `http://` / `https://` | HTTP requests | `https://api.example.com` |
| `mcp://` | External MCP tools | `mcp://tools/search` |
| `host://optimizer` | Built-in optimizer toolchain | `host://optimizer` |
| `host://architect` | Built-in AgentSpec compiler toolchain | `host://architect` |
| `node:` | Node built-in modules (requires `agentscript.npm.json`) | `node:path`, `node:fs/promises` |
| `npm:` | Installed npm packages (requires `agentscript.npm.json`) | `npm:yaml`, `npm:@scope/util` |

### Memory URIs

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import memory Runs from "sqlite://./.agentscript/memory.db#runs"
```

File memory uses JSONL format. SQLite memory uses a fixed schema with namespaced records.

### File URIs

Relative paths are resolved from the importing `.as` file (or from the current working directory in REPL). Path access is constrained to the workspace root.

## Agents and functions

Agents contain configuration and functions. Functions create runtime scopes. Cross-agent calls create isolated function scopes and nested trace events.

```agentscript
result = Worker(input)
result = Worker.run(input)
```

`AgentName(input)` calls the target agent's `main func`. `AgentName.funcName(input)` calls a named function.

A function may implicitly return its final top-level expression. See [Final Expression Return](./final-expression-return.md) for the full rule.

### Entry rules

- A program may have at most one `main agent`.
- An agent may have at most one `main func`.
- Multi-agent programs must declare a `main agent`.
- `main agent { ... }` may omit the agent name.
- `main func(input) { ... }` may omit the function name.

## Configuration

`model`, `role`, and `description` are scoped configuration values used by `generate`.

```agentscript
agent A {
    model Qwen
    role "Researcher"
    description "Collect facts and answer carefully."
}
```

A child scope can override these values:

```agentscript
func careful(input) {
    model Strong
    role "Specialist"
    ...
}
```

## Values and Contract Blocks

Runtime values are JSON-oriented:

- `string`, `number`, `boolean`, `none`
- `list`, `object`

Contract blocks describe structured entry inputs and structured `generate` outputs:

```agentscript
main func(input {
    question: string
    max_results: number
}) {
    ...
}

generate({ input: "Extract facts" }) -> {
    ok: boolean
    title
    items: list[json]
    meta: json
}
```

Contract fields use newline-separated `label: value` entries. Commas are not allowed. A label-only field means `label: default_value`; the default value is defined by the contract's usage site. `generate` output contracts default label-only fields to `string`, so `title` means `title: string`. Input contracts do not define a default value and must use explicit `label: value` fields.

Supported contract types: `string`, `number`, `boolean`, `json`, `list`, `list[T]` where T is any supported type.

Contract blocks are used where the language expects a named structural block: function input parameters and `generate(...) -> { ... }` output contracts. `use one of { ... }` uses the same contract block convention for candidate entries, but its values are candidate expressions rather than contract types and it does not define a label-only default value. The `generate({ ... })` argument itself is a JSON-like options object, not a contract block. Contract blocks are not object literals and not a full static type system.

Object literals use JSON-like syntax: fields are written as `key: value`, and multiple fields must be separated with commas.

## Explicit context with `use`

`use` selects values that may be included in later `generate` prompts within the current scope and child scopes.

```agentscript
use input.question
use Requirements max 4k
use past_lessons max 2k
use input.question as user
use docs.summary max 4k as evidence
```

### Rules

- Unused variables do not enter prompts.
- Tool outputs do not automatically enter prompts.
- Memory query results do not automatically enter prompts.
- Trace events do not automatically enter prompts.
- `use value max n` applies a context budget.
- `use value as label` attaches a literal context label to the selected source.
- `use value max n as label` applies the budget first, then attaches the label.
- `llm`, `tool`, `agent`, `memory` bindings cannot be used.
- Function bindings cannot be used.
- `use` declarations are inherited by child scopes.

### Context labels

The label after `as` is literal label text. It must be either a single identifier or a string literal. It is not an expression, is not evaluated, and does not read variables from scope.

```agentscript
use docs as evidence
use docs.summary max 4k as "retrieved evidence"
use input.question as user
```

`as evidence` labels the context section as `evidence` even if a variable named `evidence` exists. Labels organize prompt sections and trace output; they do not change provider message roles such as `system`, `user`, or `assistant`.

### Deferred evaluation

`use expr max budget` declares a context source, not a snapshot. The expression is re-evaluated when `generate` builds the prompt. This means updates to a variable made after `use` but before `generate` are visible at generation time.

For the full design semantics, see [`use ... as ...`](./use-as.md).

### Selectable context: `use one of`

`use one of` makes a single context slot selectable without turning optimization
into hidden runtime state. It keeps the semantics of `use`, but declares
multiple candidate sources under one shared label:

```agentscript
use one of {
    none:     empty
    compact:  scratch.digest max 500
    verbose:  scratch.summary max 4k
    grounded: docs.top5 max 4k selected
} as "evidence"
```

Exactly one candidate is selected before a visible `generate` builds its prompt.
`selected` marks the source-level default; if no candidate is marked, the first
candidate is the default. `empty` means this context slot is deliberately absent.
The model sees only the selected source, not the candidate list.

See [`use one of ...`](./use-one-of.md) for constraints, trace requirements, and
the optimizer contract.

## Generate

`generate` calls the current model and requires an `input` instruction. A return contract is optional.

```agentscript
answer = generate({
    input: "Answer using the selected context.",
    max_output: 800,
    attempts: 3,
    debug: true
}) -> {
    ok: boolean
    answer
    reason
}
```

### Semantics

- `input` is the per-generation instruction. Required.
- `max_output` is the output generation budget (number or `2k` style). Optional.
- `attempts` controls retry for JSON parse errors or contract mismatch. It is the maximum total number of attempts, including the first one. Optional, defaults to 1.
- `temperature` is a provider sampling hint. Optional. Unsupported provider hints default to warn in debug mode and ignore otherwise.
- `think` is a provider/model reasoning hint. Optional. Unsupported provider hints default to warn in debug mode and ignore otherwise.
- `strict` controls contract validation strictness. Optional, defaults to false.
- `debug` prints the full prompt to stderr. Optional, defaults to false.
- The optional `-> { ... }` block declares the expected output contract.
- Without `-> { ... }`, the generate output is unconstrained: AgentScript does not add a return schema to the prompt, does not request provider structured output, and does not coerce or validate the returned value. Free-form generate is allowed but not recommended for agent workflows.
- Provider errors (auth, network, timeout, missing model) fail directly without retry.
- Contract validation includes coercion (e.g. `"true"` -> `true`, `"42"` -> `42`).

For prompt construction, identity, retry, and trace semantics, see [`generate`](./generate.md).

## Control flow

### If / else

```agentscript
if answer.ok and not input.dry_run {
    return answer
} else {
    return fallback(answer)
}
```

Supported operators: `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `and`, `or`, `not`. Compound assignment supports `+=` and `-=`. Context budgets and loop limits use `max`, so `<` remains an ordinary comparison operator like `==`.

### Loop until

```agentscript
done = false

loop until done max 6 {
    observation = observe(input)
    done = observation.ok
}
```

Checks the condition before each iteration. Exits when the condition is true or the iteration limit is reached.

### Repeat

```agentscript
repeat * 3 {
    result = attempt(input)
    if result.ok {
        return result
    }
}
```

Each iteration creates a child scope. Outer variables updated inside the loop persist across iterations. New variables created inside are discarded after each iteration.

### For in

```agentscript
for step in plan.steps max 12 {
    result = Executor(step)
    results.add(result)
}
```

The list is evaluated once at loop start. Each iteration creates a child scope. The loop variable is scoped to the body.

Structured parallel list work is available as an expression:

```agentscript
results = parallel for step in plan.steps max 10 {
    Executor(step)
}
```

`parallel for` runs independent iterations concurrently, returns results in input order, and forbids shared mutable outer state. See [`parallel for`](./parallel-for.md) for the full design.

## Lists and JSON helpers

```agentscript
first = items[0]
count = items.length
items.add(new_item)
summary = items.summary
```

- `list[index]` is read-only. Index must be a non-negative integer.
- `list.add(value)` mutates the list. Takes exactly one argument.
- `.length` returns the list length.
- `.summary` returns a JSON-safe runtime view of the list. It is not an LLM-generated summary or semantic compression; any prompt-size reduction comes from explicit context budgets such as `use scratch.summary max 2k`.

## Tools

Tools are imported by URI scheme and called with structured JSON arguments.

```agentscript
import tool Find from "sh://find"
import tool Grep from "sh://grep"
import tool File from "file://workspace"
import tool Env from "env://process"
import tool Http from "https://api.example.com"
import tool Search from "mcp://search"
```

### Find

```agentscript
files = Find.run({
    path: ".",
    name: "*.ts",
    type: "file",
    max: 50
})
```

### Grep

```agentscript
matches = Grep.run({
    path: "src",
    pattern: "TODO",
    include: "*.ts",
    max: 100
})
```

### ReadRange

```agentscript
lines = ReadRange.run({
    path: "src/main.as",
    start: 1,
    max: 20
})
```

### File

```agentscript
file = File.read({
    path: "README.md"
})
entries = File.list({
    path: "src"
})
result = File.write({
    path: "output.md",
    content: "# Result"
})
result = File.patch({
    path: "file.as",
    search: "old",
    replace: "new"
})
result = File.undo(effects)
```

Tool success results are objects with `ok: true`. `File.read` returns `content`, `File.list` returns `entries`, and write/patch operations return undoable effect records. `File.undo` accepts a list of effect records and reverses them.

### Env

```agentscript
home = Env.get({
    name: "HOME"
})
```

`Env.get` returns `{ ok: true, value }`, where `value` is `null` when the variable is unset.

### Http

```agentscript
response = Http.get({
    url: "/api/data",
    headers: { Authorization: "Bearer ..." },
    timeout: 10000
})
response = Http.post({
    url: "/api/submit",
    body: { key: "value" },
    timeout: 10000
})
```

HTTP requests are restricted to the origin of the import URI.

HTTP methods return `{ ok, status, body, json }`. `ok` is true for 2xx status
codes, `body` is the response text, and `json` is the parsed JSON value or
`null` when the response body is not valid JSON. Relative URLs resolve against
the import URI, and cross-origin targets are rejected. Object request bodies are
JSON-sanitized and serialized; set `content-type: application/json` explicitly
when the server requires it.

### MCP

MCP support is stdio-only. `mcp://name` resolves to a server entry in
`agentscript.mcp.json` at the workspace root.

```json
{
  "mcpServers": {
    "search": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server-search"]
    }
  }
}
```

Server `env` values may reference host environment variables with `$NAME`
segments. Missing variables expand to an empty string. `${NAME}` and default
value syntax are not part of the config format.

Use `call({ tool, args })` for MCP tool names that are not AgentScript
identifiers:

```agentscript
result = Search.call({
    tool: "web-search",
    args: {
        query: input.query
    }
})
```

Identifier-safe MCP tool names can also be called directly:

```agentscript
result = Search.search({
    query: input.query
})
```

MCP tool results are ordinary data and must be explicitly selected with `use` to
enter prompt context.

### Security

- General shell entry points (`sh://sh`, `sh://bash`, `sh://zsh`, `sh://fish`) are forbidden.
- File paths are constrained to the workspace root.
- Symlinks escaping the workspace are not followed.
- Write operations return effect records for audit and undo.
- MCP tools are treated as effectful and are not allowed inside `parallel for`.

## Memory

Memory provides durable, explicit, auditable state across runs.

```agentscript
import memory Lessons from "file://./.agentscript/lessons.jsonl"
import memory Runs from "sqlite://./.agentscript/memory.db#runs"
```

## File imports

File imports load local files as explicit context resources.

```agentscript
import file Requirements from "./requirements.md"
import file Config from "./config.json"

agent Assistant {
    func answer(input) {
        use Requirements max 4k
        use Config
        generate({ input: "Answer from the referenced file." }) -> {
            ok: boolean
            answer
        }
    }
}
```

Text files are loaded as strings. JSON files are parsed as JSON values. File contents must be explicitly `use`d to enter prompt context.

### API

```agentscript
Lessons.add({
    kind: "lesson",
    text: reflection.insight,
    goal: input.goal
})

past = Lessons.query({
    kind: "lesson",
    text: input.goal,
    limit: 5
})

use past max 2k
```

### Rules

- Memory bindings cannot be used directly as prompt context.
- Query results are ordinary data and must be explicitly selected with `use`.
- `add` takes one object argument. Runtime adds `id`, `created_at`, `updated_at`.
- `query` supports `text` (case-insensitive substring over `record.text` and the JSON-safe record view), `kind` (exact match), `where` (exact field match), and `limit`.
- File memory uses JSONL format with automatic file and directory creation.
- SQLite memory uses a fixed schema. No arbitrary SQL is exposed.

## Agent composition

Multi-agent composition uses imports, function calls, and explicit parameter passing.

```agentscript
import agent Planner from "./planner.as"
import agent Executor from "./executor.as"

main agent Controller {
    main func(input) {
        plan = Planner(input)
        results = []
        for step in plan.steps max 10 {
            result = Executor({
                goal: input.goal,
                step: step
            })
            results.add(result)
        }
        results.summary
    }
}
```

Each agent call creates an isolated scope. Context boundaries are never implicitly crossed. Trace events are nested.

## Reserved words

`import`, `from`, `main`, `agent`, `func`, `use`, `as`, `max`, `loop`, `until`, `repeat`, `for`, `in`, `return`, `if`, `else`, `and`, `or`, `not`, `generate`, `true`, `false`, `none`, `string`, `number`, `boolean`, `json`, `list`.

The following are NOT reserved: `input`, `act`, `reason`, `observe`, `reflect`, `answer`, `scratch`, `done`, `task`, `output`, `context`, `repair`.

## Execution model

```text
source -> tokenizer -> parser -> AST -> semantic analyzer -> interpreter -> trace + result
```

The interpreter is a tree-walking evaluator. There is no IR, bytecode, or compilation step.

## Modules

| Module | Path | Responsibility |
|--------|------|---------------|
| Tokenizer | `src/parser/tokenizer.ts` | Lexical analysis |
| Parser | `src/parser/parser.ts` | Recursive descent parsing |
| Semantic analyzer | `src/semantic/analyzer.ts` | Static semantic checks |
| Interpreter | `src/runtime/interpreter.ts` | Entry point, agent/function calls |
| Evaluator | `src/runtime/evaluator.ts` | Expression evaluation, tool dispatch, use resolution |
| Generator | `src/runtime/generate.ts` | Generate execution, repair, context building |
| Scope | `src/runtime/scope.ts` | Variable scope, config, use declarations |
| Context builder | `src/runtime/context.ts` | Prompt construction, clipping |
| LLM provider | `src/providers/llm/` | OpenAI, Anthropic, Ollama |
| Memory provider | `src/providers/memory/` | File JSONL, SQLite |
| Tool provider | `src/providers/tools/` | Host tool implementations |
| CLI | `src/bin/agentscript.ts` | Command-line interface |
| REPL | `src/bin/repl.ts` | Interactive REPL |

## Non-goals

AgentScript v0.1.x does not provide:

- A general workflow engine.
- General parallel execution syntax.
- General transactions or automatic rollback.
- Arbitrary SQL.
- Automatic long-term memory.
- Automatic prompt capture of local variables.
- Automatic modification of `.as` source files.
- A full static type system.
