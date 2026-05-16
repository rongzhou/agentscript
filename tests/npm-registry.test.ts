import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkNodeImport, checkNpmImport, loadNpmRegistry } from "../src/language/npm-registry.js";

function workspaceWithRegistry(registry: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "agentscript-npm-registry-"));
  writeFileSync(join(dir, "agentscript.npm.json"), JSON.stringify(registry));
  return dir;
}

describe("npm registry", () => {
  it("denies npm and node imports without a registry", () => {
    const registry = loadNpmRegistry(mkdtempSync(join(tmpdir(), "agentscript-empty-")));

    expect(() => checkNpmImport("npm:yaml", registry)).toThrow("Package 'yaml' is not allowed");
    expect(() => checkNodeImport("node:path", registry)).toThrow("Node module 'path' is not allowed");
  });

  it("allows configured npm packages, sub-paths, and node modules", () => {
    const registry = loadNpmRegistry(
      workspaceWithRegistry({
        allow: {
          node: ["path", "fs/promises"],
          npm: {
            yaml: { version: "^2.0.0", exports: ["parse-cst"] },
            "@scope/util": {},
          },
        },
      }),
    );

    expect(checkNodeImport("node:path", registry)).toBe("path");
    expect(checkNpmImport("npm:yaml", registry).packageName).toBe("yaml");
    expect(checkNpmImport("npm:yaml/parse-cst", registry).subPath).toBe("parse-cst");
    expect(checkNpmImport("npm:@scope/util", registry).packageName).toBe("@scope/util");
    expect(() => checkNpmImport("npm:yaml/not-allowed", registry)).toThrow("sub-path 'not-allowed'");
  });

  it("rejects malformed registry entries", () => {
    expect(() => loadNpmRegistry(workspaceWithRegistry({ allow: { node: ["node:path"] } }))).toThrow(
      "must omit the node: prefix",
    );
    expect(() => loadNpmRegistry(workspaceWithRegistry({ allow: { npm: { yaml: { version: 1 } } } }))).toThrow(
      "allow.npm.yaml.version must be string",
    );
  });
});
