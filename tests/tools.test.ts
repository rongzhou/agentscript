import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { HostToolProvider, SchemeToolProvider } from "../src/providers/tools/index.js";
import { uriScheme } from "../src/language/uri.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../src/runtime/types.js";

const request: ToolCallRequest = {
  toolName: "Find",
  uri: "sh://find",
  method: "run",
  args: [],
};

describe("tool URI providers", () => {
  it("extracts URI schemes", () => {
    expect(uriScheme("sh://find")).toBe("sh");
    expect(uriScheme("mcp://tools/search")).toBe("mcp");
    expect(uriScheme("https://api.example.com")).toBe("https");
  });

  it("dispatches tool calls by URI scheme", async () => {
    const shProvider: ToolProvider = {
      async call(received) {
        return {
          provider: "sh",
          tool: received.toolName,
        };
      },
    };
    const provider = new SchemeToolProvider({ sh: shProvider });

    await expect(provider.call(request)).resolves.toEqual({
      provider: "sh",
      tool: "Find",
    });
    await expect(provider.call({ ...request, uri: "mcp://tools/search" })).rejects.toThrow(
      /Unsupported tool URI scheme 'mcp'/,
    );
  });

  it("runs concrete workspace shell and file tools without a general shell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "const value = generate();\n");
    writeFileSync(join(dir, "src", "b.md"), "notes\n");
    const provider = new HostToolProvider(dir);

    await expect(
      provider.call({ ...request, args: [{ path: "src", name: "*.ts", type: "file", max: 10 }] }),
    ).resolves.toEqual({
      ok: true,
      files: ["src/a.ts"],
    });
    await expect(
      provider.call({ ...request, uri: "sh://grep", args: [{ path: "src", pattern: "generate", include: "*.ts" }] }),
    ).resolves.toEqual({
      ok: true,
      matches: [{ path: "src/a.ts", line: 1, text: "const value = generate();" }],
    });
    await expect(provider.call({ ...request, uri: "sh://sh", args: [{}] })).rejects.toThrow(/Forbidden shell tool/);
  });

  it("supports workspace file write and undo effects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    writeFileSync(join(dir, "out.txt"), "old");
    const provider = new HostToolProvider(dir);

    const result = await provider.call({
      toolName: "File",
      uri: "file://workspace",
      method: "write",
      args: [{ path: "out.txt", content: "new" }],
    });

    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("new");
    expect(result).toMatchObject({
      ok: true,
      effects: [
        {
          action: "write",
          undoable: true,
        },
      ],
    });
    await undoEffects(provider, result);
    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("old");
  });

  it("undoes newly created workspace files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const provider = new HostToolProvider(dir);

    const result = await provider.call({
      toolName: "File",
      uri: "file://workspace",
      method: "write",
      args: [{ path: "created.txt", content: "new" }],
    });

    await undoEffects(provider, result);
    expect(() => readFileSync(join(dir, "created.txt"), "utf8")).toThrow();
  });

  it("supports workspace file patch and undo effects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    writeFileSync(join(dir, "out.txt"), "hello old world");
    const provider = new HostToolProvider(dir);

    const result = await provider.call({
      toolName: "File",
      uri: "file://workspace",
      method: "patch",
      args: [{ path: "out.txt", search: "old", replace: "new" }],
    });

    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("hello new world");
    expect(result).toMatchObject({
      ok: true,
      effects: [
        {
          action: "patch",
          undoable: true,
        },
      ],
    });
    await undoEffects(provider, result);
    expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("hello old world");
  });

  it("rejects HTTP tool requests to origins outside the imported URI", async () => {
    const provider = new HostToolProvider();

    await expect(
      provider.call({
        toolName: "Http",
        uri: "https://api.example.com",
        method: "get",
        args: [{ url: "https://metadata.example.net/latest" }],
      }),
    ).rejects.toThrow(/does not match import origin/);
  });

  it("does not follow symlinks that escape the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "agentscript-workspace-"));
    const outside = mkdtempSync(join(tmpdir(), "agentscript-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(workspace, "outside"));
    const provider = new HostToolProvider(workspace);

    await expect(
      provider.call({
        toolName: "File",
        uri: "file://workspace",
        method: "read",
        args: [{ path: "outside/secret.txt" }],
      }),
    ).rejects.toThrow(/Path escapes workspace/);

    await expect(
      provider.call({
        ...request,
        args: [{ path: ".", name: "secret.txt", type: "file", max: 10 }],
      }),
    ).resolves.toEqual({
      ok: true,
      files: [],
    });
  });

  it("requires explicit tool arguments instead of defaulting missing values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const provider = new HostToolProvider(dir);

    await expect(
      provider.call({
        ...request,
        args: [{}],
      }),
    ).rejects.toThrow(/Find.run.path is required/);
    await expect(
      provider.call({
        ...request,
        args: [{ path: ".", max: 0 }],
      }),
    ).rejects.toThrow(/Expected a positive integer/);
  });

  it("records tool effects in runtime trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const ast = parse(`
      import tool File from "file://workspace"

      main agent A {
        main func(input) {
          return File.write({
            path: "out.txt",
            content: "content"
          })
        }
      }
    `);

    const result = await executeAgent(ast, {}, { workspaceRoot: dir });

    expect(result.trace[0]).toMatchObject({
      kind: "tool",
      data: {
        scheme: "file",
        effects: [
          {
            action: "write",
            undoable: true,
          },
        ],
      },
    });
  });
});

async function undoEffects(
  provider: HostToolProvider,
  result: Awaited<ReturnType<HostToolProvider["call"]>>,
): Promise<void> {
  if (!hasEffects(result)) {
    return;
  }
  await provider.call({
    toolName: "File",
    uri: "file://workspace",
    method: "undo",
    args: [result.effects],
  });
}

function hasEffects(
  value: Awaited<ReturnType<HostToolProvider["call"]>>,
): value is RuntimeValue & { effects: RuntimeValue[] } {
  return (
    !Array.isArray(value) &&
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { effects?: unknown }).effects)
  );
}
