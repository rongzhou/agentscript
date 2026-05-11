import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeAgent } from "../src/runtime/interpreter.js";
import { loadProgram, loadProgramSource } from "../src/runtime/loader.js";
import { MockToolProvider } from "../src/providers/mock/provider.js";
import { analyze } from "../src/semantic/analyzer.js";

describe("regression fixtures", () => {
  it("loads, checks, and executes fixtures/v0.as", async () => {
    const program = loadProgram("fixtures/v0.as");

    expect(analyze(program).diagnostics).toEqual([]);
    await expect(
      executeAgent(program, { question: "What is AgentScript?" }, { toolProvider: new MockToolProvider() }),
    ).resolves.toMatchObject({
      value: {
        ok: true,
      },
    });
  });

  it("loads, checks, and executes fixtures/v1.as", async () => {
    const program = loadProgram("fixtures/v1.as");

    expect(analyze(program).diagnostics).toEqual([]);
    await expect(executeAgent(program, { goal: "Ship V1" })).resolves.toMatchObject({
      value: {
        ok: true,
        first: "step-1",
        count: 2,
      },
    });
  });

  it("loads, checks, and executes fixtures/v2.as with file memory", async () => {
    const dir = join(tmpdir(), `agentscript-v2-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const sourcePath = join(dir, "v2.as");
    const source = readFileSync("fixtures/v2.as", "utf8");
    writeFileSync(sourcePath, source);
    const program = loadProgramSource(source, { sourcePath });

    expect(analyze(program).diagnostics).toEqual([]);
    await expect(
      executeAgent(program, { goal: "Ship V2 memory" }, { sourcePath, workspaceRoot: dir }),
    ).resolves.toMatchObject({
      value: {
        ok: true,
        lessons: 0,
      },
    });
    expect(readFileSync(join(dir, ".agentscript", "lessons.jsonl"), "utf8")).toContain("Ship V2 memory");
  });
});
