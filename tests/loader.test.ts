import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeAgent } from "../src/runtime/core/interpreter.js";
import { loadProgram, loadProgramSource } from "../src/runtime/program/loader.js";

describe("loadProgram", () => {
  it("loads imported agents from another file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    mkdirSync(join(dir, "agents"));
    const mainFile = join(dir, "main.as");
    const plannerFile = join(dir, "agents", "planner.as");

    writeFileSync(
      plannerFile,
      `
      agent Planner {
        main func plan(input) {
          return {
            ok: true,
            goal: input.goal
          }
        }
      }

      agent Helper {
        main func(input) {
          return input
        }
      }
    `,
    );
    writeFileSync(
      mainFile,
      `
      import agent Planner from "./agents/planner.as"

      main agent App {
        main func(input) {
          return Planner(input)
        }
      }
    `,
    );

    const program = loadProgram(mainFile);

    expect(program.imports).toEqual([]);
    expect(program.agents.map((agent) => agent.name)).toEqual(["Planner", "Helper", "App"]);
    expect(program.agents.find((agent) => agent.name === "Planner")!.isMain).toBe(false);

    const result = await executeAgent(program, { goal: "ship v1" });
    expect(result.value).toEqual({
      ok: true,
      goal: "ship v1",
    });
  });

  it("keeps sibling agents needed by an imported agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    mkdirSync(join(dir, "agents"));
    const mainFile = join(dir, "main.as");
    const plannerFile = join(dir, "agents", "planner.as");

    writeFileSync(
      plannerFile,
      `
      agent Helper {
        main func(input) {
          return {
            helped: input.goal
          }
        }
      }

      agent Planner {
        main func(input) {
          return Helper(input)
        }
      }
    `,
    );
    writeFileSync(
      mainFile,
      `
      import agent Planner from "./agents/planner.as"

      main agent App {
        main func(input) {
          return Planner(input)
        }
      }
    `,
    );

    const program = loadProgram(mainFile);
    const result = await executeAgent(program, { goal: "ship imports" });

    expect(program.agents.map((agent) => agent.name)).toEqual(["Helper", "Planner", "App"]);
    expect(program.agents.every((agent) => agent.name === "App" || !agent.isMain)).toBe(true);
    expect(result.value).toEqual({
      helped: "ship imports",
    });
  });

  it("keeps recursive agent dependencies and resolves their file imports relative to their own files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    mkdirSync(join(dir, "agents"));
    const mainFile = join(dir, "main.as");
    const controllerFile = join(dir, "agents", "controller.as");
    const workerFile = join(dir, "agents", "worker.as");
    writeFileSync(join(dir, "agents", "note.txt"), "dependency context");

    writeFileSync(
      workerFile,
      `
      import file Note from "./note.txt"

      agent Worker {
        main func(input) {
          return {
            value: Note
          }
        }
      }
    `,
    );
    writeFileSync(
      controllerFile,
      `
      import agent Worker from "./worker.as"

      agent Controller {
        main func(input) {
          return Worker(input)
        }
      }
    `,
    );
    writeFileSync(
      mainFile,
      `
      import agent Controller from "./agents/controller.as"

      main agent App {
        main func(input) {
          return Controller(input)
        }
      }
    `,
    );

    const program = loadProgram(mainFile);
    const result = await executeAgent(program, {});

    expect(program.agents.map((agent) => agent.name)).toEqual(["Worker", "Controller", "App"]);
    expect(result.value).toEqual({
      value: "dependency context",
    });
  });

  it("preserves duplicate agent names from distinct imported files for semantic diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    mkdirSync(join(dir, "agents"));
    const mainFile = join(dir, "main.as");
    const firstFile = join(dir, "agents", "first.as");
    const secondFile = join(dir, "agents", "second.as");

    writeFileSync(
      firstFile,
      `
      agent Worker {
        main func(input) {
          return "first"
        }
      }
    `,
    );
    writeFileSync(
      secondFile,
      `
      agent Worker {
        main func(input) {
          return "second"
        }
      }
    `,
    );
    writeFileSync(
      mainFile,
      `
      import agent Worker from "./agents/first.as"
      import agent Worker from "./agents/second.as"

      main agent App {
        main func(input) {
          return input
        }
      }
    `,
    );

    const program = loadProgram(mainFile);

    expect(program.agents.map((agent) => agent.name)).toEqual(["Worker", "Worker", "App"]);
  });

  it("requires sourcePath when loading source with relative imports", () => {
    expect(() =>
      loadProgramSource(`
        import file Note from "./note.txt"

        main agent A {
          main func(input) {
            return Note
          }
        }
      `),
    ).toThrow(/sourcePath is required/);
  });

  it("normalizes file and sqlite memory import paths relative to the source file", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-imports-"));
    const sourcePath = join(dir, "main.as");
    const program = loadProgramSource(
      `
        import memory FileMem from "file://./.agentscript/lessons.jsonl"
        import memory SqliteMem from "sqlite://./.agentscript/memory.db#lessons"

        main agent A {
          main func(input) {
            return input
          }
        }
      `,
      { sourcePath },
    );

    expect(program.imports.map((item) => item.uri)).toEqual([
      `file://${join(dir, ".agentscript", "lessons.jsonl")}`,
      `sqlite://${join(dir, ".agentscript", "memory.db")}#lessons`,
    ]);
  });

  it("includes resolved file path when an agent import fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const mainFile = join(dir, "main.as");
    const missingFile = join(dir, "missing.as");
    writeFileSync(
      mainFile,
      `
      import agent Missing from "./missing.as"

      main agent App {
        main func(input) {
          return input
        }
      }
    `,
    );

    expect(() => loadProgram(mainFile)).toThrow(new RegExp(missingFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
