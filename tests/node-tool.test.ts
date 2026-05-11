import { describe, expect, it } from "vitest";
import { NodeToolProvider } from "../src/providers/tools/node.js";
import type { NpmRegistry } from "../src/providers/tools/npm-registry.js";

function registry(modules: string[]): NpmRegistry {
  return { allow: { node: new Set(modules), npm: new Map() }, path: null };
}

describe("node tool provider", () => {
  it("calls Node built-in functions and reads JSON-safe properties", async () => {
    const provider = new NodeToolProvider(registry(["path"]));

    await expect(provider.call({ toolName: "Path", uri: "node:path", method: "join", args: ["a", "b"] })).resolves.toBe(
      "a/b",
    );
    await expect(provider.call({ toolName: "Path", uri: "node:path", method: "sep", args: [] })).resolves.toBe("/");
    await expect(
      provider.call({ toolName: "Path", uri: "node:path", method: "join", args: [], propertyRead: true }),
    ).rejects.toThrow("cannot be read as a property");
  });

  it("treats call like a normal module member", async () => {
    const provider = new NodeToolProvider(registry(["path"]));

    await expect(
      provider.call({
        toolName: "Path",
        uri: "node:path",
        method: "call",
        args: [{ method: "basename", args: ["/tmp/file.txt"] }],
      }),
    ).rejects.toThrow("Unknown method 'call'");
  });

  it("rejects unauthorized modules", async () => {
    const provider = new NodeToolProvider(registry([]));

    await expect(provider.call({ toolName: "Path", uri: "node:path", method: "join", args: [] })).rejects.toThrow(
      "Node module 'path' is not allowed",
    );
  });
});
