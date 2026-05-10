# npm and node tools

This document defines how AgentScript programs call npm packages and Node built-in modules through the `npm:` and `node:` tool URI schemes.

For tool imports in general, see [Language Reference](./language.md). For prompt context selection, see [`use ... as ...`](./use-as.md). For generation sites, see [`generate`](./generate.md).

## Purpose

AgentScript programs sometimes need ordinary scripting work before or after an LLM call: parse YAML, read a file, hash a string, split Markdown into sections. The `.as` language itself does not implement these; they already exist as mature JavaScript libraries.

`npm:` and `node:` let an AgentScript program reuse that ecosystem directly, without an external TypeScript wrapper.

```agentscript
import tool Path from "node:path"
import tool Fs from "node:fs/promises"
import tool Yaml from "npm:yaml"
```

AgentScript stays focused on prompt context. Normal data processing is delegated to the package.

## Scope

`npm:` and `node:` are designed for JSON-in / JSON-out libraries. They are not a general FFI.

Supported:

```text
functions that accept JSON-safe values and return JSON-safe values
async functions that return Promises of JSON-safe values
named exports that are JSON-safe values
CJS/ESM packages resolved by Node's module loader
```

Not supported:

```text
builder patterns that return class instances for chained calls
APIs that return Date / URL / Buffer / Stream / TypedArray / Map / Set
callback-style APIs
APIs that require `new Tool.Cls(...)`
passing npm functions as AgentScript values
browser-only, Deno-only, or Bun-only packages
TypeScript source that is not compiled to JavaScript
```

Expect a package to "just work" when its public API is JSON-shaped. For other packages, write a small wrapper npm package that re-exports a JSON-friendly API, and import that wrapper from AgentScript.

## URI forms

### `node:` scheme

```agentscript
import tool Path from "node:path"
import tool FsPromises from "node:fs/promises"
import tool Crypto from "node:crypto"
import tool Url from "node:url"
```

Rules:

```text
node:<module> matches Node's built-in URL-style import
no version is encoded; built-in modules ship with Node
sub-paths such as node:fs/promises are allowed
the module must be explicitly listed in agentscript.npm.json
```

### `npm:` scheme

```agentscript
import tool Yaml from "npm:yaml"
import tool Marked from "npm:marked"
import tool Scoped from "npm:@acme/util"
import tool Sub from "npm:some-pkg/sub/path"
```

Rules:

```text
npm:<package> is resolved against the workspace's node_modules
scoped packages are written npm:@scope/pkg
sub-paths are written npm:pkg/sub
the package must be npm installed by the host project
AgentScript never installs packages
the package (and any sub-paths) must be listed in agentscript.npm.json
```

Imported names in AgentScript follow normal `import tool` rules and are just identifiers. They do not need to match the package name.

## Registry

`agentscript.npm.json` in the workspace root declares which `npm:` and `node:` imports are permitted. Without this file, all `npm:` and `node:` imports are rejected at check time and at runtime.

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

Fields:

```text
allow.node
  string array
  each entry is a Node built-in module name without the node: prefix
  sub-paths such as "fs/promises" are allowed

allow.npm
  object keyed by package name
  version   optional semver range; checked against the installed package.json
  exports   optional list of allowed sub-paths; default allows only the bare package
  effectful optional; reserved for future per-package opt-out; default true
```

Semantics:

```text
default deny: entries not listed are rejected
scope packages like "@acme/util" must be listed with the @ prefix
subPath must be declared in exports; missing subPaths are rejected
version is validated at runtime using the installed package.json
```

The registry never lists commands, paths, or secrets. Like `agentscript.mcp.json`, it is an auditable capability list, not a runtime configuration.

## Recommended syntax

Tool calls use positional arguments, matching how the underlying JavaScript function is called:

```agentscript
joined = Path.join("a", "b", "c")
content = Fs.readFile("README.md", "utf8")
doc = Yaml.parse(content)
```

Property reads pick up JSON-safe named exports:

```agentscript
separator = Path.sep
```

Dynamic method names go through `call`:

```agentscript
parsed = Yaml.call({
    method: "parse",
    args: [content]
})
```

The four forms in one place:

```agentscript
// positional call
result = Tool.method(arg1, arg2)

// property read
value = Tool.constant

// async call (Promise auto-awaited)
content = Fs.readFile("README.md", "utf8")

// dynamic method name
result = Tool.call({
    method: "stringSplit",
    args: ["text", "."]
})
```

## Calling semantics

Given:

```agentscript
doc = Yaml.parse(text)
```

AgentScript:

```text
1. Resolve the URI npm:yaml through the registry.
2. Dynamic-import the module once per run and cache it.
3. Look up the method "parse":
   - prefer mod.parse
   - fall back to mod.default?.parse for CJS/default-export interop
4. Marshal each argument to a JSON-safe value.
5. Reject any argument that is an AgentScript binding (tool, llm, agent, memory, function).
6. Invoke the function with positional arguments.
7. If the return is a Promise, await it.
8. Marshal the return value back to a RuntimeValue; reject anything not JSON-safe.
```

Rules:

```text
argument count is unbounded
arguments must be JSON-safe
Promise returns are automatically awaited
non-function members with no arguments are treated as property reads
non-function members with arguments raise an error
```

### `call` form

```agentscript
result = Tool.call({
    method: "someName",
    args: [a, b, c]
})
```

Rules:

```text
method must be a non-empty string
args must be a list
args are positional, not keyword
call is a reserved method; it never matches a module export named "call"
```

### Property reads

```agentscript
sep = Path.sep
```

Rules:

```text
only JSON-safe values are readable
functions, classes, and symbols are not readable via property access
use Tool.method(...) for callable members
```

## Argument and return value marshalling

Arguments and return values must be JSON-shaped:

```text
allowed: null, string, number, boolean, arrays, plain objects
rejected:
  undefined
  functions
  Symbol
  BigInt
  class instances (Date, URL, Buffer, Stream, TypedArray, Map, Set, ...)
  circular references
```

Rejection produces a path-qualified error:

```text
Npm tool 'Yaml.parse' returned invalid value at result.items[3].created_at: class instance is not JSON-safe
Npm tool 'Yaml.parse' argument at position 0 expects JSON-safe value at argument, got tool binding
Node tool 'Path.join' argument at position 1 expects JSON-safe value at argument, got memory binding
```

When a package's natural return shape is not JSON-safe, wrap it:

```agentscript
// Instead of using a Date directly:
// createdAt = Pkg.now()          // rejected: Date instance

// Ask for the serialized form:
createdAtIso = Pkg.nowIso()
```

Or introduce a thin npm wrapper in the host project that re-exports a JSON-shaped API.

## Async and awaiting

Every AgentScript expression is evaluated within an async runtime. Promise-returning functions are awaited automatically:

```agentscript
content = Fs.readFile("README.md", "utf8")
use content max 8k as "file content"
```

There is no explicit `await` keyword. If a function returns a Promise that rejects, the error is translated into an AgentScript runtime error with tool, method, and original message.

## Effects and `parallel for`

npm and node tools are treated as effectful by default. They are rejected inside `parallel for` bodies, just like `sh://`, `mcp://`, and `http://` effectful methods.

Rejected:

```agentscript
results = parallel for file in files max 20 {
    Fs.readFile(file.path, "utf8")
}
```

Diagnostic:

```text
effectful operation 'Fs.readFile' is not allowed inside parallel for
```

Move the reads outside:

```agentscript
contents = []

for file in files max 20 {
    contents.add(Fs.readFile(file.path, "utf8"))
}

summaries = parallel for content in contents max 20 {
    SummarizeChunk(content)
}
```

Even when a specific function is read-only, AgentScript does not distinguish at the method level in the first release. This stays conservative; finer-grained opt-in may come later via the registry's `effectful` field.

## Capability rules

Three independent gates protect the workspace:

```text
1. Registry allow-list: only listed node: and npm: targets are importable.
2. Explicit import: each .as file still has to import the tool by name.
3. Prompt boundary: return values never enter prompts implicitly;
   use ... as ... is still required.
```

There is no CLI flag to bypass the registry. A missing `agentscript.npm.json` means no npm or node imports are allowed.

High-risk Node modules (`node:child_process`, `node:vm`, `node:worker_threads`, `node:fs` synchronous APIs, etc.) can be allow-listed, but the trade-off is the host's responsibility. Prefer the safest module that does the job.

## `--check`

`agentscript --check` stays static and offline:

```text
read agentscript.npm.json if present
validate every npm: / node: import against the registry
do not dynamic-import the module
do not check installed versions
do not check whether a method exists
```

Runtime-only validation:

```text
dynamic import and resolve the module
version check against installed package.json
method existence
marshalling of arguments and return values
```

This lets `--check` run in CI without `node_modules`.

## `--dry-run`

`agentscript --dry-run` does not execute npm or node tool calls. The registry allow-list is still enforced; the call itself returns `null`. Later `generate` calls continue to run against the dry-run LLM provider.

## Trace

npm and node tool calls use the existing `tool` trace kind. The `scheme` field is set to `npm` or `node`:

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

Trace never includes module paths, registry contents, or stack traces.

## Example: YAML front matter

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

Registry:

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

## Example: Markdown pre-processing

```agentscript
import tool Fs from "node:fs/promises"
import tool Marked from "npm:marked"
import llm Fast from "ollama://localhost:11434/qwen3.6"

main agent SectionSummarizer {
    model Fast
    role "Editor"
    description "Summarize one section of a Markdown file."

    main func(input {
        path string
        heading string
    }) {
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
        // Example helper using AgentScript list / object operations;
        // the real implementation would iterate tokens to collect the block
        // under the matching heading.
        tokens
    }
}
```

## Example: node crypto identifier

```agentscript
import tool Crypto from "node:crypto"
import llm Fast from "ollama://localhost:11434/qwen3.6"

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

Registry:

```json
{
  "allow": {
    "node": ["crypto"],
    "npm": {}
  }
}
```

## Common errors

```text
Package 'yaml' is not allowed by agentscript.npm.json
  → add "yaml" under allow.npm in agentscript.npm.json

Node module 'fs' is not allowed by agentscript.npm.json
  → add "fs" (or "fs/promises") under allow.node

Failed to load npm package 'yaml': Cannot find package 'yaml'. Possible causes: package is not installed or workspace root is incorrect.
  → run npm install yaml in the workspace

Package 'yaml' installed version '1.10.0' does not satisfy '^2.3' in agentscript.npm.json
  → upgrade the installed package or relax the range

Unknown method 'Yaml.toYaml'
  → check the package API; the name might be 'stringify'

Npm tool 'Yaml.parse' returned invalid value at result.extra: class instance is not JSON-safe
  → wrap the package or pick a function that returns a plain object

effectful operation 'Fs.readFile' is not allowed inside parallel for
  → move the call before the parallel for; pass the loaded data in as a list
```

## Comparison with other tool schemes

```text
node:  in-process, Node built-ins, no install, low overhead
npm:   in-process, host's installed packages, low overhead, JSON-in/JSON-out only
mcp:   out-of-process stdio server, JSON-RPC, sandbox-friendly, higher latency
sh:    out-of-process command execution with strict allow-list
file:  built-in file operations with workspace boundary
http/https: external HTTP endpoint with origin restriction
```

Pick the scheme that matches the job. For pure JavaScript utilities, `npm:` is usually the shortest path.

## Design checklist

Before changing `npm:` or `node:`, verify:

```text
Does every import still require an entry in agentscript.npm.json?
Does AgentScript still refuse to install packages?
Are arguments and return values still JSON-safe only?
Are npm and node tools still effectful in parallel for?
Does --check remain static and offline?
Does --dry-run still skip actual module calls?
Does trace still hide module paths and stack traces?
Are errors still path-qualified with tool and method?
```

## Summary

```text
node: calls Node built-in modules.
npm:  calls npm packages installed by the host project.

Both are governed by agentscript.npm.json.
Both use positional arguments and JSON-safe marshalling.
Both are effectful and are rejected inside parallel for.
Neither installs anything; neither changes the prompt boundary.
```

Canonical example:

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
