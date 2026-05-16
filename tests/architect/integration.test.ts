import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/architect/compiler/index.js";
import { parse } from "../../src/parser/parser.js";
import { analyze } from "../../src/semantic/analyzer.js";
import { architectFixtures, readFixture } from "./helpers.js";

describe("architect integration", () => {
  for (const fixture of architectFixtures) {
    it(`${fixture} compiles to semantically valid AgentScript`, () => {
      const compiled = compileSpec(readFixture(fixture));
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      const program = parse(compiled.source);
      const result = analyze(program);
      expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    });
  }
});
