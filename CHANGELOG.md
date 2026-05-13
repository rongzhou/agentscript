# Changelog

All notable changes to AgentScript will be documented in this file.

## 0.1.18 - 2026-05-13

### Added

- Added the V6 `host://agentscript` optimizer toolchain with `inspect`, `trial`, and `specialize`.
- Added optimizer CLI mode: `agentscript optimizer.as target.as --...`.
- Added label-based `use one of` site ids for runtime variants and trace output.
- Added `examples/optimizer/` and English/Chinese optimizer documentation.

### Changed

- Allowed `AgentScript.trial(...)` inside `parallel for` while keeping source-writing `AgentScript.specialize(...)` effectful.

## 0.1.11 - 2026-05-10

### Added

- Added `node:` and `npm:` tool providers gated by `agentscript.npm.json`.
- Added JSON-safe host marshalling for npm/node tool arguments and return values.
- Added `examples/node-crypto.as` to demonstrate importing `node:crypto`.
- Added English and Chinese npm/node tool documentation.

### Changed

- Extended `--check` to validate `npm:` and `node:` tool imports against the registry.
- Extended `--dry-run` to skip real npm/node tool calls while preserving registry checks.
- Treat `npm:` and `node:` tool calls as effectful inside `parallel for`.

### Verified

- Verified formatting, type checking, full test suite, and production build.

## 0.1.7 - 2026-05-09

### Added

- Added `parallel for` as a structured parallel expression for independent bounded list work.
- Added runtime concurrency control through `--concurrency <n>` and SDK execution options.
- Added arithmetic and comparison support for `+`, `-`, `<`, and `>`.
- Added compound assignment with `+=` and `-=`.
- Added `examples/arithmetic.as` and updated `examples/plan-execute.as` to demonstrate the new language features.
- Added English and Chinese `parallel for` documentation.

### Changed

- Updated README, README-CN, language references, examples, recipes, and tests for `parallel for` and arithmetic operators.
- Simplified `recipes/code-review.as` with `parallel for` for independent TODO/FIXME scans.
- Cleaned user-facing documentation to remove internal implementation details and stale planned wording.

### Verified

- Verified formatting, type checking, full test suite, sample program execution, and production build.

## 0.1.6 - 2026-05-09

### Added

- Added `--mock` as the explicit CLI override for deterministic local runs.
- Added `--dry-run` for prompt and trace inspection without model calls.
- Added clearer Ollama diagnostics when `think` output consumes the response budget before final content is produced.

### Changed

- Made `agentscript run` call real LLM providers by default.
- Removed the legacy `--real-llm` CLI and REPL compatibility interfaces.
- Increased the `repo-review` recipe generation budget for reliable Ollama `qwen3.6` `think` runs.
- Updated README, README-CN, and installation docs for the real-by-default CLI flow.

### Verified

- Verified `recipes/repo-review.as` with local Ollama `qwen3.6`, shell tools, explicit context, structured output, trace, and `think: "medium"`.

## 0.1.5 - 2026-05-09

### Changed

- Switched context budgets from `use expr < budget` to `use expr max budget`.
- Switched loop and for-in iteration limits to `max` syntax.
- Restored `<` as an ordinary numeric comparison operator.
- Required comma separators between object literal fields.
- Updated current docs, examples, tutorials, fixtures, and tests for the new syntax.

## 0.1.4 - 2026-05-08

### Added

- Added `max_output` as the explicit `generate` output budget.
- Added `temperature`, `think`, and `strict` generate options.
- Added provider request mapping for generate provider hints.

### Changed

- Replaced generate `limit` usage with `max_output` in current docs, examples, tutorials, and fixtures.
- Expanded English and Chinese `generate` design docs with configuration semantics.
- Updated shape validation so `strict: true` disables coercion and rejects extra fields.

## 0.1.3 - 2026-05-08

### Added

- Added final expression return for functions.
- Added literal context labels with `use context as label`.
- Added agent role and description to prompt identity construction.
- Added trace and built context output for context labels.

### Changed

- Updated README, examples, and language references for labeled context usage.

## 1.0.0 - 2026-05-07

### Added

- Initial public release of AgentScript.
- Parser, semantic analyzer, and interpreter for `.as` programs.
- CLI support for parse, check, execute, REPL, trace, quiet, and verbose modes.
- LLM providers for OpenAI, Anthropic, and Ollama protocol URIs.
- Tool providers for Find, Grep, Sed, File, Env, and Http operations.
- Explicit prompt context model with `use`, scoped context inheritance, and context budgets.
- `generate` with structured output shapes, validation, limited repair attempts, and trace output.
- Agent/function composition including cross-agent calls and imported agents.
- Control flow support for `if`/`else`, `loop until`, `repeat`, and `for item in list < n`.
- List and JSON helpers including item access, `.length`, `.add(value)`, and `.summary`.
- File import support for static context inputs.
- Memory imports with explicit `add` and `query` operations.
- File JSONL and SQLite memory backends.
- Tutorials, examples, regression fixtures, and automated tests.
