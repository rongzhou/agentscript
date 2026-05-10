import { describe, expect, it } from "vitest";
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
});
