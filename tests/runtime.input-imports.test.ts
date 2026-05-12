import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";

describe("runtime input-imports", () => {
  it("fills missing contracted entry input through the input provider", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question: string
        }) {
          return {
            question: input.question,
            input: input
          }
        }
      }
    `);

    const result = await executeAgent(
      ast,
      {},
      {
        inputProvider: {
          async read(request) {
            expect(request.path).toEqual(["input", "question"]);
            return "interactive question";
          },
        },
      },
    );

    expect(result.value).toEqual({
      question: "interactive question",
      input: {
        question: "interactive question",
      },
    });
    expect(result.trace).toContainEqual(
      expect.objectContaining({
        kind: "input",
      }),
    );
  });

  it("uses existing contracted entry input without asking the provider", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question: string
        }) {
          return input.question
        }
      }
    `);

    const result = await executeAgent(
      ast,
      { question: "provided" },
      {
        inputProvider: {
          async read() {
            throw new Error("should not read");
          },
        },
      },
    );

    expect(result.value).toBe("provided");
  });

  it("rejects missing contracted entry input without an input provider", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question: string
        }) {
          return input.question
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/no interactive input provider/);
  });

  it("validates contracted entry input values", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question: string
        }) {
          return input.question
        }
      }
    `);

    await expect(executeAgent(ast, { question: false })).rejects.toThrow(/must be a string/);
  });

  it("loads imported json files as json values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const scriptFile = join(dir, "agent.as");
    writeFileSync(join(dir, "data.json"), '{"title":"AgentScript","tags":["agent","dsl"]}');

    const ast = parse(`
      import file Data from "./data.json"

      main agent A {
        main func(input) {
          return {
            title: Data.title,
            firstTag: Data.tags[0]
          }
        }
      }
    `);

    const result = await executeAgent(ast, {}, { sourcePath: scriptFile });

    expect(result.value).toEqual({
      title: "AgentScript",
      firstTag: "agent",
    });
  });
});
