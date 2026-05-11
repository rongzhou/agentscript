import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "../src/parser/parser.js";
import { GenerateRuntime } from "../src/runtime/generate.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { RuntimeError } from "../src/runtime/errors.js";
import { RuntimeScope } from "../src/runtime/scope.js";
import { buildValueFromShape } from "../src/runtime/shape.js";
import type { GenerateExpr, Stmt } from "../src/ast/types.js";
import type { GenerateRequest, RuntimeValue, TraceEvent } from "../src/runtime/types.js";

describe("generate runtime", () => {
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
    const event = result.trace.find((item) => item.kind === "generate");
    expect(event?.data.attempts).toBe(2);
    expect(event?.data.ok).toBe(true);
    expect(event?.data.errors).toEqual([expect.stringContaining("LLM result field must be a boolean")]);
  });

  it("records generate failure details in trace", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Record failed attempts."

        main func act(input) {
          return generate({ input: "answer", attempts: 2 }) -> {
              ok boolean
          }
        }
      }
    `);
    const agent = ast.agents[0]!;
    const expr = returnGenerateExpr(agent.functions[0]!.body[0]!);
    const scope = new RuntimeScope();
    scope.setConfig("model", { __agentScriptResource: "llm", name: "Qwen", uri: "openai://gpt-4.1-mini" });
    scope.setConfig("role", "Assistant");
    scope.setConfig("description", "Record failed attempts.");
    const trace: TraceEvent[] = [];
    const runtime = new GenerateRuntime(
      {
        async generate(): Promise<RuntimeValue> {
          return { ok: "maybe" };
        },
      },
      trace,
      {
        currentAgent: () => agent,
        async evaluate(value) {
          return value.kind === "StringExpr" ? value.value : null;
        },
        async resolveContextUses() {
          return [];
        },
      },
    );

    await expect(runtime.evaluateGenerate(expr, scope)).rejects.toThrow(/must be a boolean/);
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      kind: "generate",
      data: {
        attempts: 2,
        ok: false,
        error: expect.stringContaining("LLM result field must be a boolean"),
        errors: [
          expect.stringContaining("LLM result field must be a boolean"),
          expect.stringContaining("LLM result field must be a boolean"),
        ],
        result: { ok: "maybe" },
      },
    });
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
  return request.returnShape ? buildValueFromShape(request.returnShape) : null;
}

function returnGenerateExpr(stmt: Stmt): GenerateExpr {
  if (stmt.kind !== "ReturnStmt" || stmt.value.kind !== "GenerateExpr") {
    throw new Error("Expected return generate expression");
  }
  return stmt.value;
}
