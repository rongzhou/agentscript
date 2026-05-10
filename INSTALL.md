# Install AgentScript

AgentScript is distributed as an npm package and can also be run from source.

## Requirements

- Node.js >= 22.13.
- npm.
- Optional: Ollama, OpenAI, or Anthropic credentials for real model calls.

The SQLite memory backend uses Node's built-in `node:sqlite` module, so Node.js 22.13 or newer is required.

## Install from npm

After the package is published:

```bash
npm install -g @rong/agentscript
agentscript run recipes/code-review.as --input '{"path":"src"}'
```

## Run with npx

After the package is published:

```bash
npx @rong/agentscript run recipes/code-review.as --input '{"path":"src"}'
```

## Run from source

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
npm install
npm run build
npm run execute -- recipes/code-review.as --input '{"path":"src"}'
```

During local development, prefer:

```bash
npm run execute -- tutorials/react.as --input '{"question":"What is AgentScript?"}'
npm run check -- examples/react.as
npm run parse -- examples/react.as
```

## Real LLM providers

By default, `agentscript run` calls the configured real LLM provider. Use `--mock` for deterministic local flow checks, or `--dry-run` to inspect prompts and trace without model calls.

### OpenAI

```bash
export OPENAI_API_KEY="..."
agentscript run recipes/code-review.as --input '{"path":"src"}'
```

Use an AgentScript import such as:

```agentscript
import llm OpenAI from "openai://gpt-4.1-mini"
```

### Anthropic

```bash
export ANTHROPIC_API_KEY="..."
agentscript run recipes/code-review.as --input '{"path":"src"}'
```

Use an AgentScript import such as:

```agentscript
import llm Claude from "anthropic://claude-sonnet-4-0"
```

### Ollama

Run Ollama locally, then use an import such as:

```agentscript
import llm Qwen from "ollama://localhost:11434/qwen3.6"
```

## Validate a checkout

```bash
npm run typecheck
npm test
npm run build
```
