import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as api from "../src/index.js";

describe("public package API", () => {
  it("exports only stable runtime entry points and provider factories", () => {
    expect(Object.keys(api).sort()).toEqual([
      "ProtocolLlmProvider",
      "RuntimeError",
      "SemanticError",
      "analyze",
      "assertSemanticallyValid",
      "createDefaultMemoryProvider",
      "createDefaultToolProvider",
      "executeAgent",
      "formatSemanticDiagnostics",
      "formatTrace",
      "loadProgram",
      "loadProgramSource",
      "parse",
    ]);
  });

  it("does not expose internal runtime implementation classes", () => {
    expect(api).not.toHaveProperty("Evaluator");
    expect(api).not.toHaveProperty("GenerateRuntime");
    expect(api).not.toHaveProperty("RuntimeScope");
    expect(api).not.toHaveProperty("tokenize");
  });

  it("declares explicit package exports for stable value and type entry points", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      types?: string;
      exports?: Record<string, unknown>;
    };

    expect(packageJson.types).toBe("dist/index.d.ts");
    expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual([
      ".",
      "./architect/spec/types",
      "./ast/types",
      "./package.json",
    ]);
  });
});
