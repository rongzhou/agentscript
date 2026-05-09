import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { RuntimeError } from "../src/runtime/errors.js";
import { buildValueFromShape } from "../src/runtime/shape.js";
import type { GenerateRequest, RuntimeValue } from "../src/runtime/types.js";

describe("generate", () => {
  it("passes generate budgets and visible use context to the LLM provider", async () => {
    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Answer test questions."

        main func act(input) {
          use input.question max 2k
          return generate({ input: "answer", max_output: 300 }) -> {
              ok boolean
          }
        }
      }
    `);

    await executeAgent(
      ast,
      { question: "q" },
      {
        llmProvider: {
          async generate(request) {
            requests.push(request);
            return buildValueFromRequestShape(request);
          },
        },
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.maxOutput).toEqual({ amount: 300 });
    expect(requests[0]!.model).toMatchObject({
      name: "Qwen",
      uri: "openai://gpt-4.1-mini",
    });
    expect(requests[0]!.context).toHaveLength(1);
    expect(requests[0]!.context[0]!.budget).toEqual({ amount: 2, unit: "k" });
    expect(requests[0]!.builtContext.system).toContain("You are Assistant.");
    expect(requests[0]!.builtContext.system).toContain("Answer test questions.");
    expect(requests[0]!.builtContext.system).not.toContain("openai://gpt-4.1-mini");
    expect(requests[0]!.builtContext.context[0]!.source).toBe("input.question");
    expect(requests[0]!.builtContext.finalUserMessage).toContain("[0]");
    expect(requests[0]!.builtContext.finalUserMessage).toContain("source: input.question");
    expect(requests[0]!.builtContext.finalUserMessage).toContain("Return JSON matching this schema:");
  });

  it("passes generate provider hints and runtime validation options", async () => {
    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Answer test questions."

        main func act(input) {
          return generate({
            input: "answer",
            max_output: 2k,
            attempts: 2,
            temperature: 0.2,
            think: "medium",
            strict: true,
            debug: false
          }) -> {
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
            return { ok: true };
          },
        },
      },
    );

    expect(requests[0]).toMatchObject({
      maxOutput: { amount: 2, unit: "k" },
      temperature: 0.2,
      think: "medium",
      strict: true,
      debug: false,
    });
  });

  it("prints generate debug prompts to stderr when requested", async () => {
    const debug = vi.spyOn(console, "error").mockImplementation(() => {});
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Debug prompts."

        main func act(input) {
          return generate({ input: "answer", debug: true }) -> {
              ok boolean
          }
        }
      }
    `);

    try {
      await executeAgent(
        ast,
        {},
        {
          llmProvider: {
            async generate(request) {
              return buildValueFromRequestShape(request);
            },
          },
        },
      );
      expect(debug).toHaveBeenCalledWith(expect.stringContaining("AgentScript generate debug"));
      expect(debug).toHaveBeenCalledWith(expect.stringContaining("Final user message:"));
    } finally {
      debug.mockRestore();
    }
  });

  it("retries repairable generate output failures with repair context", async () => {
    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Repair invalid structured output."

        main func act(input) {
          return generate({ input: "answer", attempts: 2 }) -> {
              ok boolean
          }
        }
      }
    `);

    const result = await executeAgent(
      ast,
      {},
      {
        llmProvider: {
          async generate(request) {
            requests.push(request);
            return requests.length === 1 ? { ok: "maybe" } : { ok: true };
          },
        },
      },
    );

    expect(result.value).toEqual({ ok: true });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.instruction).toContain("Previous generation failed.");
    expect(requests[1]!.instruction).toContain('"ok": "maybe"');
    expect(result.trace.find((event) => event.kind === "generate")?.data.attempts).toBe(2);
  });

  it("retries provider JSON parse failures but does not retry infrastructure errors", async () => {
    const parseFailureRequests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Repair invalid JSON."

        main func act(input) {
          return generate({ input: "answer", attempts: 2 }) -> {
              ok boolean
          }
        }
      }
    `);

    await expect(
      executeAgent(
        ast,
        {},
        {
          llmProvider: {
            async generate(request) {
              parseFailureRequests.push(request);
              if (parseFailureRequests.length === 1) {
                throw new RuntimeError("LLM provider did not return JSON: not json");
              }
              return { ok: true };
            },
          },
        },
      ),
    ).resolves.toMatchObject({ value: { ok: true } });
    expect(parseFailureRequests).toHaveLength(2);

    const infrastructureRequests: GenerateRequest[] = [];
    await expect(
      executeAgent(
        ast,
        {},
        {
          llmProvider: {
            async generate(request) {
              infrastructureRequests.push(request);
              throw new RuntimeError("LLM provider request failed: socket closed");
            },
          },
        },
      ),
    ).rejects.toThrow(/socket closed/);
    expect(infrastructureRequests).toHaveLength(1);
  });

  it("rejects invalid generate attempts", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Reject invalid attempts."

        main func act(input) {
          return generate({ input: "answer", attempts: 0 }) -> {
              ok boolean
          }
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/generate attempts must be a positive integer/);
  });

  it("resolves use context at generate time instead of declaration time", async () => {
    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Answer from scratch."

        main func(input) {
          scratch = []
          use scratch.summary max 2k
          scratch.add({ fact: "A" })
          scratch.add({ fact: "B" })

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
        llmProvider: {
          async generate(request) {
            requests.push(request);
            return buildValueFromRequestShape(request);
          },
        },
      },
    );

    expect(requests[0]!.context[0]).toMatchObject({
      source: "scratch.summary",
      value: [{ fact: "A" }, { fact: "B" }],
    });
  });

  it("rejects LLM results that do not match generate return shape", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      agent A {
        model Qwen
        role "Assistant"
        description "Validate generated output."

        main func(input) {
          return generate({ input: "x" }) -> {
              ok boolean
          }
        }
      }
    `);

    await expect(
      executeAgent(
        ast,
        {},
        {
          llmProvider: {
            async generate(): Promise<RuntimeValue> {
              return { ok: "yes" };
            },
          },
        },
      ),
    ).rejects.toThrow(RuntimeError);
  });

  it("coerces simple string values in LLM generate results before shape validation", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      agent A {
        model Qwen
        role "Assistant"
        description "Coerce unstable LLM JSON values."

        main func(input) {
          return generate({ input: "x" }) -> {
              ok boolean
              count number
              flags list[boolean]
              scores list[number]
              text string
          }
        }
      }
    `);

    const result = await executeAgent(
      ast,
      {},
      {
        llmProvider: {
          async generate(): Promise<RuntimeValue> {
            return {
              ok: "true",
              count: "42",
              flags: ["false", "true"],
              scores: ["1", "2.5"],
              text: "42",
            };
          },
        },
      },
    );

    expect(result.value).toEqual({
      ok: true,
      count: 42,
      flags: [false, true],
      scores: [1, 2.5],
      text: "42",
    });
  });

  it("builds empty mock defaults for list shape fields", () => {
    const ast = parse(`
      agent A {
        main func(input) {
          return generate({ input: "x" }) -> {
              title string
              tags list[string]
          }
        }
      }
    `);
    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    if (stmt.kind !== "ReturnStmt" || stmt.value.kind !== "GenerateExpr" || !stmt.value.returnShape) {
      throw new Error("unexpected test AST");
    }

    expect(buildValueFromShape(stmt.value.returnShape)).toEqual({
      title: "",
      tags: [],
    });
  });

  it("does not coerce LLM generate results in strict mode", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      agent A {
        model Qwen
        role "Assistant"
        description "Reject coercion in strict mode."

        main func(input) {
          return generate({ input: "x", strict: true }) -> {
              ok boolean
          }
        }
      }
    `);

    await expect(
      executeAgent(
        ast,
        {},
        {
          llmProvider: {
            async generate(): Promise<RuntimeValue> {
              return { ok: "true" };
            },
          },
        },
      ),
    ).rejects.toThrow(/must be a boolean/);
  });

  it("includes source location in runtime errors", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      agent A {
        model Qwen
        role "Assistant"
        description "Return ordinary JSON."

        main func(input) {
          return input.missing.call()
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/at \d+:\d+/);
  });

  it("loads imported text files relative to the source path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const scriptFile = join(dir, "agent.as");
    const docFile = join(dir, "requirements.md");
    writeFileSync(docFile, "Build a focused AgentScript runtime.");

    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"
      import file Requirements from "./requirements.md"

      main agent A {
        model Qwen
        role "Assistant"
        description "Use imported files."

        main func(input) {
          use Requirements max 100
          return generate({ input: "summarize" }) -> {
              ok boolean
          }
        }
      }
    `);

    const requests: GenerateRequest[] = [];
    await executeAgent(
      ast,
      {},
      {
        sourcePath: scriptFile,
        llmProvider: {
          async generate(request) {
            requests.push(request);
            return buildValueFromRequestShape(request);
          },
        },
      },
    );

    expect(requests[0]!.context[0]).toMatchObject({
      value: "Build a focused AgentScript runtime.",
      budget: { amount: 100 },
    });
  });
});

function buildValueFromRequestShape(request: GenerateRequest): RuntimeValue {
  if (!request.returnShape) {
    throw new Error("unexpected missing return shape");
  }
  return buildValueFromShape(request.returnShape);
}
