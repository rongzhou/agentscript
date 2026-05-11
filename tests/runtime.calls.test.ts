import { describe, expect, it } from "vitest";
import { MockToolProvider } from "../src/providers/mock/index.js";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";

describe("runtime calls", () => {
  it("calls another agent with AgentName(input) shorthand", async () => {
    const ast = parse(`
      main agent App {
        main func(input) {
          return Worker(input)
        }
      }

      agent Worker {
        main func work(input) {
          return {
            ok: true,
            value: input.value
          }
        }
      }
    `);

    const result = await executeAgent(ast, { value: "done" });

    expect(result.value).toEqual({ ok: true, value: "done" });
    expect(result.trace).toContainEqual(
      expect.objectContaining({
        kind: "agent",
      }),
    );
  });

  it("keeps subagent trace events nested under the agent call", async () => {
    const ast = parse(`
      import tool Search from "mcp://tools/search"

      main agent App {
        main func(input) {
          return Worker(input)
        }
      }

      agent Worker {
        main func search(input) {
          observation = Search.search(input.query)
          return observation
        }
      }
    `);

    const result = await executeAgent(ast, { query: "agents" }, { toolProvider: new MockToolProvider() });
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      kind: "agent",
      data: {
        agent: "Worker",
        function: "search",
      },
    });
    expect(result.trace[0]!.data.trace).toEqual([
      expect.objectContaining({
        kind: "tool",
      }),
    ]);
  });

  it("calls a named function on another agent", async () => {
    const ast = parse(`
      main agent App {
        main func(input) {
          return Worker.run(input.value)
        }
      }

      agent Worker {
        func run(value) {
          return {
            value: value
          }
        }
      }
    `);

    const result = await executeAgent(ast, { value: "named" });

    expect(result.value).toEqual({ value: "named" });
  });
});
