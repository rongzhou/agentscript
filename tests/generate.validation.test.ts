import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { RuntimeError } from "../src/runtime/errors.js";
import { buildValueFromShape } from "../src/runtime/shape.js";
import type { RuntimeValue } from "../src/runtime/types.js";

describe("generate validation", () => {
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
});
