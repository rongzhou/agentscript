import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";

describe("parser control-flow-context", () => {
  it("parses use budgets on the use statement", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          scratch = []
          use scratch.summary max 2k
          return input
        }
      }
    `);

    const useStmt = ast.agents[0]!.functions[0]!.body[1]!;
    expect(useStmt.kind).toBe("UseStmt");
    if (useStmt.kind !== "UseStmt") return;
    expect(useStmt.value.kind).toBe("MemberExpr");
    expect(useStmt.budget).toEqual({ amount: 2, unit: "k" });
  });

  it("parses literal labels on use statements", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          use input.question as user
          use docs.summary max 4k as "retrieved evidence"
          return input
        }
      }
    `);

    const firstUse = ast.agents[0]!.functions[0]!.body[0]!;
    const secondUse = ast.agents[0]!.functions[0]!.body[1]!;
    expect(firstUse.kind).toBe("UseStmt");
    expect(secondUse.kind).toBe("UseStmt");
    if (firstUse.kind !== "UseStmt" || secondUse.kind !== "UseStmt") return;
    expect(firstUse.label).toBe("user");
    expect(secondUse.budget).toEqual({ amount: 4, unit: "k" });
    expect(secondUse.label).toBe("retrieved evidence");
  });

  it("parses if else and natural boolean expressions", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          if input.ok == true and not input.stale {
            return "ok"
          } else {
            return "repeat"
          }
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("IfStmt");
    if (stmt.kind !== "IfStmt") return;
    expect(stmt.condition).toMatchObject({
      kind: "BinaryExpr",
      operator: "and",
    });
    expect(stmt.elseBody).toHaveLength(1);
  });

  it("parses for-in list traversal", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          for step in input.steps max 6 {
            use step
          }
          return input
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("ForInStmt");
    if (stmt.kind !== "ForInStmt") return;
    expect(stmt.item.name).toBe("step");
    expect(stmt.maxIterations).toBe(6);
    expect(stmt.iterable.kind).toBe("MemberExpr");
    expect(stmt.body[0]).toMatchObject({
      kind: "UseStmt",
    });
  });

  it("parses parallel for expressions", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          results = parallel for step in input.steps max 3 {
            step.name
          }
          return results
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("AssignStmt");
    if (stmt.kind !== "AssignStmt") return;
    expect(stmt.value.kind).toBe("ParallelForExpr");
    if (stmt.value.kind !== "ParallelForExpr") return;
    expect(stmt.value.item.name).toBe("step");
    expect(stmt.value.maxIterations).toBe(3);
    expect(stmt.value.iterable.kind).toBe("MemberExpr");
    expect(stmt.value.body.at(-1)).toMatchObject({
      kind: "ExprStmt",
    });
  });

  it("parses agent-level use declarations", () => {
    const ast = parse(`
      import file Playbook from "./playbook.md"

      agent A {
        use Playbook max 2k as playbook

        func act(input) {
          return input
        }
      }
    `);

    expect(ast.agents[0]!.uses).toEqual([
      expect.objectContaining({
        kind: "UseStmt",
        label: "playbook",
        budget: { amount: 2, unit: "k" },
      }),
    ]);
  });

  it("requires agent-level use declarations before functions", () => {
    expect(() =>
      parse(`
        import file Playbook from "./playbook.md"

        agent A {
          func act(input) {
            return input
          }

          use Playbook as playbook
        }
      `),
    ).toThrow(/Agent-level use declarations must appear before function declarations/);
  });
});
