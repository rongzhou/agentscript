# Contributing to AgentScript

Thanks for helping improve AgentScript.

## Development setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Local CLI usage

```bash
npm run execute -- examples/review.as --input '{"path":"src"}'
npm run check -- examples/review.as
npm run parse -- examples/review.as
```

## Pull request checklist

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
```

For language changes:

- Update parser tests when syntax changes.
- Update semantic tests when name resolution, resource binding, or validation rules change.
- Update runtime tests when execution behavior changes.
- Update docs and tutorials when user-facing behavior changes.

For tool, memory, or provider changes:

- Add tests for successful calls.
- Add tests for permission and workspace-boundary failures.
- Add tests for error messages when inputs are invalid.
- Ensure trace output remains auditable and does not implicitly add data to prompt context.

## Design principles

- Keep the language small.
- Prefer ordinary agents, functions, JSON values, and explicit `use` over pattern-specific keywords.
- Do not implicitly add variables, trace events, tool output, or memory records to LLM prompt context.
- Keep tools and memory operations explicit, auditable, and host-authorized.
- Avoid runtime dependencies unless they are clearly justified.

## Documentation

When adding or moving docs, update `README.md` (English) and `README-CN.md` (Chinese). Historical design notes live under `docs/design-history/`.
