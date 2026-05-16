import { describe, expect, it } from "vitest";
import { asAgentSpecDraft } from "../../src/architect/spec/types.js";
import { validateSpec } from "../../src/architect/validator/index.js";
import { architectFixtures, clone, readFixture } from "./helpers.js";

describe("AgentSpec validator", () => {
  it("treats object values as drafts and rejects non-object roots", () => {
    expect(asAgentSpecDraft({})).toEqual({});
    expect(asAgentSpecDraft(null)).toBeNull();
    expect(asAgentSpecDraft([])).toBeNull();
    expect(asAgentSpecDraft("x")).toBeNull();
  });

  it("accepts all architect fixtures", () => {
    for (const fixture of architectFixtures) {
      const result = validateSpec(readFixture(fixture));
      expect(result).toEqual({ ok: true, diagnostics: [] });
    }
  });

  it("reports representative validation errors without short-circuiting", () => {
    const spec = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    delete (spec.agent as Record<string, unknown>).name;
    spec.version = "0.2";
    (spec.inputs as Record<string, unknown>).bad = { type: "object" };
    (spec.locals as Array<Record<string, unknown>>)[0]!.source = {
      kind: "tool_call",
      tool: "Missing",
      method: "search",
      args: { query: "input.missing", prior: "local.future" },
    };
    (spec.locals as Array<Record<string, unknown>>).push({
      name: "future",
      source: { kind: "tool_call", tool: "Docs", method: "search", args: { query: "x" } },
    });
    spec.model_context = [];

    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "MISSING_FIELD",
        "INVALID_VERSION",
        "UNSUPPORTED_TYPE",
        "UNKNOWN_TOOL",
        "UNKNOWN_INPUT_REF",
        "FORWARD_LOCAL_REF",
        "EMPTY_MODEL_CONTEXT",
      ]),
    );
  });

  it("rejects malformed nested shapes that would make compiler unsafe", () => {
    const missingFields = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    missingFields.output = {};
    let result = validateSpec(missingFields);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("MISSING_FIELD");

    const malformed = clone(readFixture("fixtures/architect/support-agent.spec.json"));
    (malformed.locals as unknown[])[0] = {
      name: "bad_local",
      source: {
        kind: "tool_call",
        tool: "Docs",
        method: "search",
        args: [],
      },
    };
    result = validateSpec(malformed);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("INVALID_SHAPE");

    const missingType = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    (missingType.output as { fields: Record<string, unknown> }).fields.answer = {};
    result = validateSpec(missingType);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("MISSING_FIELD");

    const nonStringType = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    (nonStringType.output as { fields: Record<string, unknown> }).fields.answer = { type: 1 };
    result = validateSpec(nonStringType);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("INVALID_SHAPE");
  });

  it("checks pattern blocks", () => {
    const unsupported = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    unsupported.pattern = "loop";
    expect(codes(validateSpec(unsupported))).toContain("UNSUPPORTED_PATTERN");

    const missing = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    missing.pattern = "react";
    expect(codes(validateSpec(missing))).toContain("MISSING_PATTERN_BLOCK");

    const unexpected = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    unexpected.pattern = "linear";
    unexpected.react = {};
    expect(codes(validateSpec(unexpected))).toContain("UNEXPECTED_PATTERN_BLOCK");
  });

  it("rejects generated-source binding conflicts before compilation", () => {
    const importConflict = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    (importConflict.tools as Array<Record<string, unknown>>)[0]!.import_name = "DocsAssistant";
    expect(codes(validateSpec(importConflict))).toContain("DUPLICATE_BINDING");

    const localConflict = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    (localConflict.locals as Array<Record<string, unknown>>)[0]!.name = "input";
    expect(codes(validateSpec(localConflict))).toContain("DUPLICATE_BINDING");

    const localImportConflict = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    (localImportConflict.locals as Array<Record<string, unknown>>)[0]!.name = "Docs";
    expect(codes(validateSpec(localImportConflict))).toContain("DUPLICATE_BINDING");
  });

  it("checks ReAct thought references, stop_when, and reserved identifiers", () => {
    const spec = clone(readFixture("fixtures/architect/react-research-agent.spec.json"));
    spec.inputs = { thought: { type: "string" } };
    (spec.output as { fields: Record<string, unknown> }).fields.scratch = { type: "string" };
    (
      (spec.react as Record<string, unknown>).reason as { output: { fields: Record<string, unknown> } }
    ).output.fields.obs = {
      type: "string",
    };
    spec.react = {
      ...(spec.react as Record<string, unknown>),
      act: { tool: "Search", method: "missing", args: { q: "thought.missing", bad: "scratch.value" } },
      stop_when: "thought.focus",
    };

    const result = validateSpec(spec);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "RESERVED_IDENTIFIER",
        "UNKNOWN_TOOL_METHOD",
        "UNKNOWN_THOUGHT_REF",
        "STOP_WHEN_NOT_BOOLEAN",
      ]),
    );
    expect(codes(result).filter((code) => code === "UNKNOWN_TOOL_METHOD")).toHaveLength(1);

    const doneField = clone(readFixture("fixtures/architect/react-research-agent.spec.json"));
    expect(codes(validateSpec(doneField))).not.toContain("RESERVED_IDENTIFIER");

    const invalidStop = clone(readFixture("fixtures/architect/react-research-agent.spec.json"));
    (invalidStop.react as Record<string, unknown>).stop_when = "thought.done == true";
    expect(codes(validateSpec(invalidStop))).toContain("INVALID_STOP_WHEN");
  });

  it("separates invalid and empty tool method shapes", () => {
    const invalid = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    (invalid.tools as Array<Record<string, unknown>>)[0]!.methods = {};
    expect(codes(validateSpec(invalid))).toContain("INVALID_SHAPE");

    const empty = clone(readFixture("fixtures/architect/docs-assistant.spec.json"));
    (empty.tools as Array<Record<string, unknown>>)[0]!.methods = [];
    expect(codes(validateSpec(empty))).toContain("EMPTY_VALUE");
  });
});

function codes(result: ReturnType<typeof validateSpec>): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}
