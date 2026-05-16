import { describe, expect, it } from "vitest";
import { RuntimeError } from "../../src/runtime/core/errors.js";
import type { RuntimeValue } from "../../src/runtime/values/values.js";
import { ArchitectToolProvider } from "../../src/architect/tool/provider.js";
import { compileSpec } from "../../src/architect/compiler/index.js";
import { readFixture } from "./helpers.js";

describe("host://architect provider", () => {
  const provider = new ArchitectToolProvider();

  it("validates and compiles AgentSpec", async () => {
    const spec = readFixture("fixtures/architect/docs-assistant.spec.json");
    await expect(call("validateSpec", { spec })).resolves.toEqual({ ok: true, diagnostics: [] });
    const compiled = await call("compileSpec", { spec });
    expect(compiled).toMatchObject({ ok: true });
    expect((compiled as { source: string }).source).toContain("main agent DocsAssistant");
  });

  it("returns soft errors for invalid input, invalid uri, validation failure, and parse errors", async () => {
    await expect(call("validateSpec", { spec: null })).resolves.toMatchObject({ ok: false, code: "invalid_input" });
    await expect(call("validateSpec", { spec: {} })).resolves.toMatchObject({
      ok: false,
      diagnostics: expect.any(Array),
    });
    await expect(call("validateSpec", { spec: {} }, "host://architect/foo")).resolves.toMatchObject({
      ok: false,
      code: "invalid_uri",
    });
    await expect(call("analyzeSource", { source: "not source" })).resolves.toMatchObject({
      ok: false,
      code: "parse_error",
    });
  });

  it("analyzes generated source", async () => {
    const compiled = compileSpec(readFixture("fixtures/architect/docs-assistant.spec.json"));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    await expect(call("analyzeSource", { source: compiled.source })).resolves.toEqual({ ok: true, diagnostics: [] });
  });

  it("returns source locations for semantic diagnostics", async () => {
    const result = await call("analyzeSource", {
      source: `
        main agent A {
          main func act(input) {
            use missing.value
            return input
          }
        }
      `,
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "UNKNOWN_IDENTIFIER",
          path: expect.stringMatching(/^source:\d+:\d+$/),
          range: expect.objectContaining({
            start: expect.objectContaining({ line: expect.any(Number), column: expect.any(Number) }),
            end: expect.objectContaining({ line: expect.any(Number), column: expect.any(Number) }),
          }),
        }),
      ],
    });
  });

  it("throws for unknown methods and malformed arguments", async () => {
    await expect(call("unknown", {})).rejects.toThrow(RuntimeError);
    await expect(call("validateSpec", undefined)).rejects.toThrow(RuntimeError);
  });

  function call(method: string, arg: unknown, uri = "host://architect") {
    return provider.call({ toolName: "Architect", uri, method, args: arg === undefined ? [] : [arg as RuntimeValue] });
  }
});
