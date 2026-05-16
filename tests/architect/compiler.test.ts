import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/architect/compiler/index.js";
import { clone, readFixture } from "./helpers.js";

describe("AgentSpec compiler", () => {
  it("compiles linear fixtures to readable AgentScript", () => {
    const compiled = compileSpec(readFixture("fixtures/architect/docs-assistant.spec.json"));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.source).toContain('import tool Docs from "mcp://support-docs"');
    expect(compiled.source).toContain("main agent DocsAssistant");
    expect(compiled.source).toContain('use relevant_docs max 8k as "documentation search results"');
    expect(compiled.source).toContain("return generate({");
    expect(compiled.source).toMatch(/\n$/);
  });

  it("compiles ReAct fixtures with loop lowering", () => {
    const compiled = compileSpec(readFixture("fixtures/architect/react-research-agent.spec.json"));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.source).toContain("scratch = []");
    expect(compiled.source).toContain('use scratch.summary max 4k as "observations"');
    expect(compiled.source).toContain("loop until done max 6 {");
    expect(compiled.source).toContain("q: thought.focus");
    expect(compiled.source).toContain("done = thought.done");
  });

  it("refuses invalid specs", () => {
    const spec = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    spec.version = "0.2";
    const compiled = compileSpec(spec);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.code).toBe("validation_required");
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toContain("INVALID_VERSION");
  });

  it("escapes strings and omits absent max_output", () => {
    const spec = clone(readFixture("fixtures/architect/react-research-agent.spec.json"));
    (spec.agent as Record<string, unknown>).description = 'Quote " and slash \\ test';
    (spec.generation as Record<string, unknown>).input = 'Answer "carefully"';
    delete (spec.generation as Record<string, unknown>).max_output;
    delete ((spec.react as Record<string, unknown>).reason as Record<string, unknown>).max_output;

    const compiled = compileSpec(spec);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.source).toContain('description "Quote \\" and slash \\\\ test"');
    expect(compiled.source).toContain('input: "Answer \\"carefully\\""');
    expect(compiled.source).not.toContain("max_output: undefined");
  });
});
