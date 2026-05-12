import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";

describe("parser use one of", () => {
  it("parses use one of candidates", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          use one of {
            none: empty
            compact: input.digest max 500
            verbose: input.summary max 4k selected
          } as evidence
          return input
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("UseOneOfStmt");
    if (stmt.kind !== "UseOneOfStmt") return;
    expect(stmt.label).toBe("evidence");
    expect(stmt.candidates.map((candidate) => candidate.name)).toEqual(["none", "compact", "verbose"]);
    expect(stmt.candidates[0]).toMatchObject({ value: undefined, selected: false });
    expect(stmt.candidates[1]).toMatchObject({ budget: { amount: 500 }, selected: false });
    expect(stmt.candidates[2]).toMatchObject({ budget: { amount: 4, unit: "k" }, selected: true });
  });

  it("requires candidate values and newline separators", () => {
    expect(() =>
      parse(`
        agent A {
          func act(input) {
            use one of {
              compact
              verbose: input.summary
            } as evidence
            return input
          }
        }
      `),
    ).toThrow("Label-only contract fields are not allowed in this contract");

    expect(() =>
      parse(`
        agent A {
          func act(input) {
            use one of { compact: input.digest, verbose: input.summary } as evidence
            return input
          }
        }
      `),
    ).toThrow("Commas are not allowed between contract block entries");
  });

  it("requires at least two candidates and one selected candidate at most", () => {
    expect(() =>
      parse(`
        agent A {
          func act(input) {
            use one of {
              compact: input.digest
            } as evidence
            return input
          }
        }
      `),
    ).toThrow("use one of requires at least two candidates");

    expect(() =>
      parse(`
        agent A {
          func act(input) {
            use one of {
              compact: input.digest selected
              verbose: input.summary selected
            } as evidence
            return input
          }
        }
      `),
    ).toThrow("use one of can mark at most one candidate as selected");
  });

  it("keeps plain use of a variable named one", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          one = input.context
          use one as evidence
          return input
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[1]!;
    expect(stmt).toMatchObject({
      kind: "UseStmt",
      label: "evidence",
      value: { kind: "IdentifierExpr", name: "one" },
    });
  });
});
