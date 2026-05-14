import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MockToolProvider } from "../src/providers/mock/tool.js";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import type {
  GenerateRequest,
  InputRequest,
  MemoryAddRequest,
  MemoryQueryRequest,
  RuntimeValue,
  ToolCallRequest,
} from "../src/runtime/types.js";

describe("runtime core", () => {
  it("executes the research regression fixture with mock providers", async () => {
    const source = readFileSync("tests/fixtures/regression-research.as", "utf8");
    const result = await executeAgent(
      parse(source),
      {
        question: "What is AgentScript?",
      },
      { toolProvider: new MockToolProvider() },
    );

    expect(result.value).toMatchObject({
      ok: true,
      text: "",
      error: "",
    });
    expect(result.trace.some((event) => event.kind === "tool")).toBe(true);
    expect(result.trace.some((event) => event.kind === "generate")).toBe(true);
    expect(result.trace.some((event) => event.kind === "use")).toBe(true);
  });

  it("reports runaway recursion as a RuntimeError", async () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return recurse(input)
        }

        func recurse(input) {
          return recurse(input)
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/Maximum call depth/);
  });

  it("allows callers to configure maximum call depth", async () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return recurse(input)
        }

        func recurse(input) {
          return recurse(input)
        }
      }
    `);

    await expect(executeAgent(ast, {}, { maxCallDepth: 2 })).rejects.toThrow(/Maximum call depth of 2 exceeded/);
    await expect(executeAgent(ast, {}, { maxCallDepth: 0 })).rejects.toThrow(/maxCallDepth must be a positive integer/);
  });

  it("closes disposable providers after execution", async () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return input
        }
      }
    `);
    const closed: string[] = [];
    const toolProvider = {
      async call(_request: ToolCallRequest): Promise<RuntimeValue> {
        return null;
      },
      async close(): Promise<void> {
        closed.push("tool");
      },
    };
    const memoryProvider = {
      async add(_request: MemoryAddRequest): Promise<RuntimeValue> {
        return null;
      },
      async query(_request: MemoryQueryRequest): Promise<RuntimeValue> {
        return [];
      },
      async close(): Promise<void> {
        closed.push("memory");
      },
    };
    const llmProvider = {
      async generate(_request: GenerateRequest): Promise<RuntimeValue> {
        return null;
      },
      async close(): Promise<void> {
        closed.push("llm");
      },
    };
    const inputProvider = {
      async read(_request: InputRequest): Promise<RuntimeValue> {
        return null;
      },
      async close(): Promise<void> {
        closed.push("input");
      },
    };

    await executeAgent(
      ast,
      {},
      {
        toolProvider,
        memoryProvider,
        llmProvider,
        inputProvider,
      },
    );

    expect(new Set(closed)).toEqual(new Set(["tool", "memory", "llm", "input"]));
  });

  it("updates outer variables from repeat attempt scopes", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Reflect on repeat attempts."

        main func act(input) {
          insight = none

          repeat * 2 {
            insight = generate({ input: "reflect" }) -> {
                value: string
            }
          }

          return insight
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toEqual({ value: "" });
  });

  it("returns none when a function has no explicit return or final expression", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          value = "missing return"
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toBeNull();
  });

  it("returns the final top-level expression from a function", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          use input.question
          answer(input)
        }

        func answer(input) {
          value = {
            ok: true,
            answer: input.question,
            tags: ["final", "expression"]
          }

          value.answer
        }
      }
    `);

    const result = await executeAgent(ast, { question: "What is AgentScript?" });

    expect(result.value).toBe("What is AgentScript?");
  });

  it("evaluates extended arithmetic and comparison operators", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return {
            product: 3 * 4,
            quotient: 12 / 3,
            lte: 3 <= 3,
            gte: 4 >= 5
          }
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toEqual({
      product: 12,
      quotient: 4,
      lte: true,
      gte: false,
    });
  });

  it("short-circuits boolean operators", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return {
            and_value: false and input.missing.value,
            or_value: true or input.missing.value
          }
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toEqual({
      and_value: false,
      or_value: true,
    });
  });

  it("supports final expression return for generate output", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Answer questions."

        main func(input) {
          use input.question

          generate({ input: "answer" }) -> {
              ok: boolean
              answer: string
          }
        }
      }
    `);

    const result = await executeAgent(ast, { question: "x" });

    expect(result.value).toEqual({ ok: true, answer: "" });
  });

  it("does not return expression statements inside nested blocks implicitly", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          if input.ok {
            "nested"
          }
        }
      }
    `);

    const result = await executeAgent(ast, { ok: true });

    expect(result.value).toBeNull();
  });

  it("returns object and list literals as final expressions", async () => {
    const objectAst = parse(`
      main agent A {
        main func(input) {
          {
            facts: [input.fact],
            source: input.source
          }
        }
      }
    `);
    const listAst = parse(`
      main agent A {
        main func(input) {
          [input.a, input.b]
        }
      }
    `);

    await expect(executeAgent(objectAst, { fact: "ok", source: "test" })).resolves.toMatchObject({
      value: {
        facts: ["ok"],
        source: "test",
      },
    });
    await expect(executeAgent(listAst, { a: 1, b: 2 })).resolves.toMatchObject({
      value: [1, 2],
    });
  });

  it("rejects local assignments that shadow imported tool names", async () => {
    const ast = parse(`
      import tool Search from "mcp://tools/search"

      main agent A {
        main func act(input) {
          Search = "local"
          return Search
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/Cannot assign to immutable tool binding 'Search'/);
  });
});
