# Changelog

All notable changes to AgentScript will be documented in this file.

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
