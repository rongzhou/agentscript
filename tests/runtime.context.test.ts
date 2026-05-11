import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { buildValueFromShape } from "../src/runtime/shape.js";
import type { GenerateRequest } from "../src/runtime/types.js";

describe("runtime context", () => {
  it("lets functions override scoped model and role configuration", async () => {
    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Fast from "openai://fast"
      import llm Strong from "openai://strong"

      main agent A {
        model Fast
        role "Assistant"
        description "Default agent description."

        main func(input) {
          return specialized()
        }

        func specialized() {
          model Strong
          role "Specialist"
          description "Specialized function description."

          return generate({ input: "x" }) -> {
              ok boolean
          }
        }
      }
    `);

    await executeAgent(
      ast,
      {},
      {
        llmProvider: {
          async generate(request) {
            requests.push(request);
            if (!request.returnShape) {
              throw new Error("unexpected missing return shape");
            }
            return buildValueFromShape(request.returnShape);
          },
        },
      },
    );

    expect(requests[0]!.model).toMatchObject({ name: "Strong", uri: "openai://strong" });
    expect(requests[0]!.identity).toMatchObject({
      role: "Specialist",
      description: "Specialized function description.",
    });
  });

  it("carries literal context labels into trace and generated context", async () => {
    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Use labeled context."

        main func(input) {
          use input.question as user
          use input.docs max 2k as "retrieved evidence"

          generate({ input: "answer" }) -> {
              ok boolean
          }
        }
      }
    `);

    const result = await executeAgent(
      ast,
      {
        question: "What is AgentScript?",
        docs: "AgentScript keeps context explicit.",
      },
      {
        llmProvider: {
          async generate(request) {
            requests.push(request);
            if (!request.returnShape) {
              throw new Error("unexpected missing return shape");
            }
            return buildValueFromShape(request.returnShape);
          },
        },
      },
    );

    expect(result.trace).toContainEqual(
      expect.objectContaining({
        kind: "use",
        data: expect.objectContaining({ source: "input.question", label: "user" }),
      }),
    );
    expect(requests[0]!.context).toEqual([
      expect.objectContaining({ source: "input.question", label: "user" }),
      expect.objectContaining({ source: "input.docs", label: "retrieved evidence" }),
    ]);
    expect(requests[0]!.builtContext.context[0]).toMatchObject({ label: "user" });
    expect(requests[0]!.builtContext.finalUserMessage).toContain("[retrieved evidence]");
  });

  it("makes agent-level use visible to every function without leaking caller function context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-agent-use-"));
    const scriptFile = join(dir, "agent.as");
    writeFileSync(join(dir, "base.md"), "base context");
    writeFileSync(join(dir, "detail.md"), "caller detail");

    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"
      import file Base from "./base.md"
      import file Detail from "./detail.md"

      main agent A {
        model Qwen
        role "Assistant"
        description "Use scoped context."
        use Base as base

        main func(input) {
          use Detail as detail
          return helper(input)
        }

        func helper(input) {
          return generate({ input: "answer" }) -> {
              ok boolean
          }
        }
      }
    `);

    await executeAgent(
      ast,
      {},
      {
        sourcePath: scriptFile,
        llmProvider: {
          async generate(request) {
            requests.push(request);
            if (!request.returnShape) {
              throw new Error("unexpected missing return shape");
            }
            return buildValueFromShape(request.returnShape);
          },
        },
      },
    );

    expect(requests[0]!.context).toEqual([
      expect.objectContaining({ source: "Base", label: "base", value: "base context" }),
    ]);
    expect(requests[0]!.context).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "Detail", label: "detail" })]),
    );
  });
});
