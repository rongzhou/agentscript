import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NpmToolProvider } from "../src/providers/tools/npm.js";
import type { NpmPackageEntry, NpmRegistry } from "../src/providers/tools/npm-registry.js";

function workspaceWithPackage(version = "1.2.3"): string {
  const workspace = mkdtempSync(join(tmpdir(), "agentscript-npm-tool-"));
  const packageDir = join(workspace, "node_modules", "fake-npm-pkg");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "fake-npm-pkg", version, type: "module" }));
  writeFileSync(
    join(packageDir, "index.js"),
    `
      export const CONSTANT = "fixed";
      export function hello(name) { return { greeting: "Hi, " + name }; }
      export async function slow(value) { return value; }
      export function getBad() { return new Map(); }
    `,
  );
  return workspace;
}

function registry(entry: NpmPackageEntry = { name: "fake-npm-pkg" }): NpmRegistry {
  return { allow: { node: new Set(), npm: new Map([["fake-npm-pkg", entry]]) }, path: null };
}

describe("npm tool provider", () => {
  it("calls package functions, awaits promises, and reads properties", async () => {
    const provider = new NpmToolProvider(registry(), workspaceWithPackage());

    await expect(
      provider.call({ toolName: "Pkg", uri: "npm:fake-npm-pkg", method: "hello", args: ["Rong"] }),
    ).resolves.toEqual({ greeting: "Hi, Rong" });
    await expect(
      provider.call({ toolName: "Pkg", uri: "npm:fake-npm-pkg", method: "slow", args: ["ok"] }),
    ).resolves.toBe("ok");
    await expect(
      provider.call({ toolName: "Pkg", uri: "npm:fake-npm-pkg", method: "CONSTANT", args: [] }),
    ).resolves.toBe("fixed");
  });

  it("supports dynamic call and rejects invalid host returns", async () => {
    const provider = new NpmToolProvider(registry(), workspaceWithPackage());

    await expect(
      provider.call({
        toolName: "Pkg",
        uri: "npm:fake-npm-pkg",
        method: "call",
        args: [{ method: "hello", args: ["AgentScript"] }],
      }),
    ).resolves.toEqual({ greeting: "Hi, AgentScript" });
    await expect(
      provider.call({ toolName: "Pkg", uri: "npm:fake-npm-pkg", method: "getBad", args: [] }),
    ).rejects.toThrow("Map is not JSON-safe");
  });

  it("checks installed versions", async () => {
    const provider = new NpmToolProvider(registry({ name: "fake-npm-pkg", version: "^2.0.0" }), workspaceWithPackage());

    await expect(
      provider.call({ toolName: "Pkg", uri: "npm:fake-npm-pkg", method: "hello", args: ["x"] }),
    ).rejects.toThrow("does not satisfy '^2.0.0'");
  });
});
