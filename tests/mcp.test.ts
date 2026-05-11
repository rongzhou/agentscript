import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { analyze } from "../src/semantic/analyzer.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const echoServer = join(fixtureDir, "fixtures", "mcp-echo-server.mjs");

describe("MCP stdio tools", () => {
  it("calls MCP tools through generic call and normalizes results", async () => {
    const workspace = mcpWorkspace();
    const ast = parse(`
      import tool Echo from "mcp://echo"

      main agent A {
        main func(input { text string }) {
          return Echo.call({
            tool: "echo",
            args: {
              text: input.text
            }
          })
        }
      }
    `);

    const result = await executeAgent(ast, { text: "hello" }, { workspaceRoot: workspace });

    expect(result.value).toEqual({
      ok: true,
      text: "hello",
      content: [{ type: "text", text: "hello" }],
      structured: { echoed: "hello" },
      isError: false,
    });
    expect(result.trace[0]).toMatchObject({
      kind: "tool",
      data: {
        tool: "Echo",
        method: "call",
        scheme: "mcp",
        uri: "mcp://echo",
        result: {
          ok: true,
          text: "hello",
        },
      },
    });
  });

  it("calls MCP tools through direct method names", async () => {
    const workspace = mcpWorkspace();
    const ast = parse(`
      import tool Echo from "mcp://echo"

      main agent A {
        main func(input { text string }) {
          return Echo.echo({
            text: input.text
          }).text
        }
      }
    `);

    const result = await executeAgent(ast, { text: "direct" }, { workspaceRoot: workspace });

    expect(result.value).toBe("direct");
  });

  it("supports MCP tool names that are not AgentScript identifiers", async () => {
    const workspace = mcpWorkspace();
    const ast = parse(`
      import tool Search from "mcp://echo"

      main agent A {
        main func(input { query string }) {
          return Search.call({
            tool: "web-search",
            args: {
              query: input.query
            }
          }).text
        }
      }
    `);

    const result = await executeAgent(ast, { query: "agentscript" }, { workspaceRoot: workspace });

    expect(result.value).toBe("result for agentscript");
  });

  it("expands environment variable references in MCP registry env values", async () => {
    process.env.AGENTSCRIPT_MCP_TEST_SUFFIX = "expanded";
    const workspace = mcpWorkspace({ env: { MCP_ECHO_ENV: "token-$AGENTSCRIPT_MCP_TEST_SUFFIX" } });
    const ast = parse(`
      import tool Echo from "mcp://echo"

      main agent A {
        main func(input) {
          return Echo.env({}).text
        }
      }
    `);

    try {
      const result = await executeAgent(ast, {}, { workspaceRoot: workspace });

      expect(result.value).toBe("token-expanded");
    } finally {
      delete process.env.AGENTSCRIPT_MCP_TEST_SUFFIX;
    }
  });

  it("reports unknown MCP tools at runtime", async () => {
    const workspace = mcpWorkspace();
    const ast = parse(`
      import tool Echo from "mcp://echo"

      main agent A {
        main func(input) {
          return Echo.missing({})
        }
      }
    `);

    await expect(executeAgent(ast, {}, { workspaceRoot: workspace })).rejects.toThrow(/Unknown MCP tool 'missing'/);
  });

  it("reports MCP server startup failures without waiting for request timeout", async () => {
    const workspace = mcpWorkspace({ command: join(tmpdir(), "missing-agentscript-mcp-server"), timeoutMs: 10_000 });
    const ast = parse(`
      import tool Echo from "mcp://echo"

      main agent A {
        main func(input) {
          return Echo.echo({})
        }
      }
    `);

    await expect(executeAgent(ast, {}, { workspaceRoot: workspace })).rejects.toThrow(/MCP server 'echo' failed/);
  });

  it("rejects missing MCP registry entries", async () => {
    const workspace = mcpWorkspace();
    const ast = parse(`
      import tool Missing from "mcp://missing"

      main agent A {
        main func(input) {
          return Missing.call({
            tool: "echo",
            args: {}
          })
        }
      }
    `);

    await expect(executeAgent(ast, {}, { workspaceRoot: workspace })).rejects.toThrow(/MCP server 'missing' not found/);
  });

  it("rejects MCP tools inside parallel for", () => {
    const ast = parse(`
      import tool Echo from "mcp://echo"

      main agent A {
        main func(input) {
          return parallel for item in [1, 2] max 2 {
            Echo.echo({ text: "x" })
            item
          }
        }
      }
    `);

    const result = analyze(ast);

    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "PARALLEL_FOR_EFFECTFUL_CALL");

    expect(diagnostics).toHaveLength(1);
  });
});

function mcpWorkspace(options: { command?: string; env?: Record<string, string>; timeoutMs?: number } = {}): string {
  const workspace = mkdtempSync(join(tmpdir(), "agentscript-mcp-"));
  writeFileSync(
    join(workspace, "agentscript.mcp.json"),
    JSON.stringify({
      mcpServers: {
        echo: {
          transport: "stdio",
          command: options.command ?? process.execPath,
          args: [echoServer],
          env: options.env,
          timeoutMs: options.timeoutMs,
        },
      },
    }),
  );
  return workspace;
}
