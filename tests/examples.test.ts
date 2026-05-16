import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeAgent } from "../src/runtime/interpreter.js";
import { loadProgram } from "../src/runtime/loader.js";
import { MockLlmProvider } from "../src/providers/mock/llm.js";
import { MockMemoryProvider } from "../src/providers/mock/memory.js";
import { HostPassthroughToolProvider } from "../src/providers/mock/host-passthrough.js";
import { MockToolProvider } from "../src/providers/mock/tool.js";
import { createAgentScriptToolProvider } from "../src/host-tools.js";
import { createDefaultToolProvider } from "../src/providers/tools/host.js";
import type { JsonObject } from "../src/runtime/types.js";
import { analyze } from "../src/semantic/analyzer.js";

describe("sample programs", () => {
  for (const dir of ["examples", "tutorials", "recipes"]) {
    for (const file of sampleFiles(dir)) {
      it(`parses, checks, and executes ${join(dir, file)}`, async () => {
        const program = loadProgram(join(dir, file));
        const semantic = analyze(program);

        expect(semantic.diagnostics).toEqual([]);
        await expect(
          executeAgent(program, inputFor(join(dir, file)), {
            toolProvider: toolProviderFor(dir, file),
            memoryProvider: new MockMemoryProvider(),
          }),
        ).resolves.toHaveProperty("value");
      });
    }
  }
});

function sampleFiles(dir: string): string[] {
  const files: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isFile() && item.name.endsWith(".as")) files.push(item.name);
    if (dir === "examples" && item.isDirectory()) {
      for (const nested of readdirSync(join(dir, item.name))) {
        if (nested.endsWith(".as")) files.push(join(item.name, nested));
      }
    }
  }
  return files.sort();
}

function inputFor(path: string): JsonObject {
  switch (path) {
    case "examples/meta/architect.as":
      return {
        request: "Build a docs assistant that searches documentation and returns answers with citations",
        target_name: "DocsAssistant",
        model_uri: "ollama://localhost:11434/qwen3.6",
      };
    case "examples/optimizer/optimizer.as":
      return {
        target: "examples/optimizer/triage.as",
        request: "Checkout is failing with 500 errors in production",
        selection: {
          "examples/optimizer/triage.as#Triage.main[style]": "detailed",
        },
        write: "preview",
        trial_trace: "none",
        output: "/tmp/triage.optimized.as",
        dry_run: true,
      };
    case "examples/optimizer/triage.as":
      return {
        request: "Checkout is failing with 500 errors in production",
      };
  }
  const file = path.split("/").pop() ?? path;
  switch (file) {
    case "changelog.as":
      return {
        diff_path: "README.md",
      };
    case "cli.as":
      return {
        name: "Rong",
        request: "Say hello from AgentScript",
      };
    case "control-flow.as":
      return {
        goal: "Triage support requests",
        items: [
          {
            title: "Checkout is down",
            urgent: true,
          },
          {
            title: "Rename workspace",
            urgent: false,
          },
        ],
      };
    case "hello.as":
      return {
        name: "Rong",
        request: "Help me learn AgentScript",
      };
    case "extract-api-data.as":
      return {
        url: "/users/1",
      };
    case "structured-generate.as":
      return {
        request: "Summarize this issue",
      };
    case "use-context.as":
      return {
        question: "What is AgentScript?",
        docs: {
          summary: "AgentScript makes prompt context explicit.",
        },
      };
    case "research-brief.as":
      return {
        question: "What is AgentScript?",
        search_url: "/search?q=AgentScript",
      };
    case "repo-review.as":
      return {
        path: ".",
      };
    case "react.as":
      return {
        question: "What is AgentScript?",
      };
    case "code-review.as":
      return {
        path: "src",
      };
    case "repl.as":
      return {};
    case "summarize-file.as":
      return {
        path: "README.md",
      };
    case "translate-docs.as":
      return {
        path: "docs",
        target_language: "English",
      };
    case "typescript-interop.as":
      return {
        label: "release-notes",
        payload: {
          version: "0.1.19",
          kind: "patch",
        },
      };
    case "use-one-of.as":
      return {
        request: "Checkout is failing for a customer",
        customer_tier: "vip",
      };
    case "plan-execute.as":
      return {
        goal: "Research AgentScript and summarize the result",
      };
    case "memory.as":
      return {
        topic: "AgentScript memory",
      };
    case "memory-reflection.as":
      return {
        goal: "Explain explicit context boundaries",
      };
    case "multi-agent.as":
      return {
        topic: "AgentScript context boundaries",
        audience: "new users",
      };
    case "multi-agent-review.as":
      return {
        audience: "new users",
        draft: "AgentScript lets you choose exactly what context enters each model call.",
      };
    case "node-crypto.as":
      return {
        label: "AgentScript V4",
      };
    default:
      return {};
  }
}

function toolProviderFor(dir: string, file: string) {
  if (dir === "examples" && file === "node-crypto.as") return createDefaultToolProvider();
  if (dir === "examples" && (file === "meta/architect.as" || file === "optimizer/optimizer.as")) {
    return new HostPassthroughToolProvider(
      createAgentScriptToolProvider(process.cwd(), {
        llmProvider: new MockLlmProvider(),
        toolProvider: new MockToolProvider(),
        memoryProvider: new MockMemoryProvider(),
      }),
    );
  }
  return new MockToolProvider();
}
