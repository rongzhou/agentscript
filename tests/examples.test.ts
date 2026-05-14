import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeAgent } from "../src/runtime/interpreter.js";
import { loadProgram } from "../src/runtime/loader.js";
import { MockMemoryProvider, MockToolProvider } from "../src/providers/mock/provider.js";
import { createDefaultToolProvider } from "../src/providers/tools/host.js";
import type { JsonObject } from "../src/runtime/types.js";
import { analyze } from "../src/semantic/analyzer.js";

describe("sample programs", () => {
  for (const dir of ["examples", "tutorials", "recipes"]) {
    for (const file of readdirSync(dir)
      .filter((item) => item.endsWith(".as"))
      .sort()) {
      it(`parses, checks, and executes ${join(dir, file)}`, async () => {
        const program = loadProgram(join(dir, file));
        const semantic = analyze(program);

        expect(semantic.diagnostics).toEqual([]);
        await expect(
          executeAgent(program, inputFor(file), {
            toolProvider: toolProviderFor(dir, file),
            memoryProvider: new MockMemoryProvider(),
          }),
        ).resolves.toHaveProperty("value");
      });
    }
  }
});

function inputFor(file: string): JsonObject {
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
  return dir === "examples" && file === "node-crypto.as" ? createDefaultToolProvider() : new MockToolProvider();
}
