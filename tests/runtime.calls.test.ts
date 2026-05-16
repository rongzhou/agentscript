import { describe, expect, it } from "vitest";
import { MockToolProvider } from "../src/providers/mock/tool.js";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/core/interpreter.js";
import { formatTrace } from "../src/runtime/trace/trace.js";
import type { ToolProvider } from "../src/runtime/values/providers.js";

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
    expect(result.trace[0]!.kind).toBe("agent");
    if (result.trace[0]!.kind !== "agent") throw new Error("expected agent trace event");
    expect(result.trace[0]!.data.trace).toEqual([
      expect.objectContaining({
        kind: "tool",
      }),
    ]);
  });

  it("mock tools follow URI schemes instead of import names", async () => {
    const ast = parse(`
      import tool Workspace from "file://workspace"
      import tool Process from "env://process"

      main agent A {
        main func(input) {
          return {
            file: Workspace.read({ path: "README.md" }),
            env: Process.get({ name: "AGENTSCRIPT_TEST_MISSING_ENV" })
          }
        }
      }
    `);

    const result = await executeAgent(ast, {}, { toolProvider: new MockToolProvider() });

    expect(result.value).toEqual({
      file: {
        ok: true,
        content: "mock file content from file://workspace",
      },
      env: {
        ok: true,
        value: null,
      },
    });
  });

  it("keeps concurrent subagent traces isolated under each agent call", async () => {
    const ast = parse(`
      import tool Search from "mcp://tools/search"

      main agent App {
        main func(input) {
          return parallel for item in input.items max 2 {
            Worker(item)
          }
        }
      }

      agent Worker {
        main func search(input) {
          observation = Search.search(input.query, input.delay)
          return observation
        }
      }
    `);
    const toolProvider: ToolProvider = {
      async call(request) {
        const query = String(request.args[0]);
        const delay = Number(request.args[1] ?? 0);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return { query };
      },
    };

    const result = await executeAgent(
      ast,
      {
        items: [
          { query: "slow", delay: 20 },
          { query: "fast", delay: 0 },
        ],
      },
      { concurrency: 2, toolProvider },
    );

    expect(result.value).toEqual([{ query: "slow" }, { query: "fast" }]);
    expect(result.trace).toHaveLength(1);
    const parallelFor = result.trace[0]!;
    expect(parallelFor).toMatchObject({
      kind: "parallel_for",
      data: { ok: true },
    });
    expect(parallelFor.kind).toBe("parallel_for");
    if (parallelFor.kind !== "parallel_for") throw new Error("expected parallel_for trace event");
    const iterations = parallelFor.data.iterations as unknown as Array<{
      index: number;
      input: { query: string; delay: number };
      result: { query: string };
      trace: Array<{ kind: string; data: { result: unknown; trace: unknown[] } }>;
    }>;
    expect(iterations.map((iteration) => iteration.input.query)).toEqual(["slow", "fast"]);

    for (const iteration of iterations) {
      expect(iteration.result).toEqual({ query: iteration.input.query });
      expect(iteration.trace).toHaveLength(1);
      const agentEvent = iteration.trace[0]!;
      expect(agentEvent).toMatchObject({
        kind: "agent",
        data: {
          agent: "Worker",
          result: { query: iteration.input.query },
        },
      });
      const nestedTrace = agentEvent.data.trace as Array<{ kind: string; data: { args: unknown[]; result: unknown } }>;
      expect(nestedTrace[0]).toMatchObject({
        kind: "tool",
        data: {
          args: [iteration.input.query, iteration.input.delay],
          result: { query: iteration.input.query },
        },
      });
    }
    expect(formatTrace(result.trace)).toContain("- iteration [0] ok");
    expect(formatTrace(result.trace)).toContain("- agent Worker.search");
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
