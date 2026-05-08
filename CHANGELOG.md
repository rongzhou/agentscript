# Changelog

All notable changes to AgentScript will be documented in this file.

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
