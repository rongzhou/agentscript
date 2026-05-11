import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

describe("module layering", () => {
  it("keeps runtime and providers independent from semantic analysis", () => {
    const offenders = sourceFiles("src/runtime", "src/providers", "src/language").filter((file) =>
      importsLayer(file, "semantic"),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps semantic analysis independent from runtime implementation", () => {
    const offenders = sourceFiles("src/semantic", "src/language").filter((file) => importsLayer(file, "runtime"));

    expect(offenders).toEqual([]);
  });
});

function sourceFiles(...roots: string[]): string[] {
  return roots.flatMap((root) => visit(root)).sort();
}

function visit(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) {
    return path.endsWith(".ts") ? [path] : [];
  }
  return readdirSync(path).flatMap((entry) => visit(join(path, entry)));
}

function importsLayer(file: string, layer: "runtime" | "semantic"): boolean {
  const source = readFileSync(file, "utf8");
  const current = relative("src", file).replace(/\\/g, "/");
  const patterns =
    layer === "runtime"
      ? [/from\s+["'][^"']*\/runtime\//, /from\s+["']\.\.\/runtime\//]
      : [/from\s+["'][^"']*\/semantic\//, /from\s+["']\.\.\/semantic\//];
  return current.split("/")[0] !== layer && patterns.some((pattern) => pattern.test(source));
}
