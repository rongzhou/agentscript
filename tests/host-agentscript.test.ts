import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeAgent } from "../src/runtime/interpreter.js";
import { loadProgram } from "../src/runtime/loader.js";
import type { RuntimeValue } from "../src/runtime/types.js";

describe("host://agentscript", () => {
  it("inspects use one of sites across imported agents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);
    const optimizer = join(dir, "optimizer.as");
    writeFileSync(
      optimizer,
      `
      import tool AgentScript from "host://agentscript"

      main agent Optimizer {
        main func(input) {
          return AgentScript.inspect({ target: input.target })
        }
      }
    `,
    );

    const result = await executeAgent(
      loadProgram(optimizer),
      { target },
      { sourcePath: optimizer, workspaceRoot: dir },
    );

    expect(result.value).toMatchObject({ ok: true });
    expect(result.value).toHaveProperty("snapshot_id");
    expect((result.value as { files: string[] }).files.sort()).toEqual(["main.as", "worker.as"]);
    expect(
      (result.value as { variant_sites: Array<{ site_id: string }> }).variant_sites.map((site) => site.site_id).sort(),
    ).toEqual(["main.as#App.main[style]", "worker.as#Worker.main[tone]"]);
  });

  it("warns about effectful target tools during inspect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = join(dir, "target.as");
    writeFileSync(
      target,
      `
      import tool Search from "mcp://search"

      main agent Target {
        main func(input) {
          use one of {
            brief: "brief"
            full: "full"
          } as style
          return input
        }
      }
    `,
    );

    const result = await runTool(dir, "inspect", { target });

    expect(result.value).toMatchObject({
      ok: true,
      warnings: [
        {
          code: "target_effectful_tool",
          tool: "Search",
          uri: "mcp://search",
        },
      ],
    });
  });

  it("runs trial selections against imported agent sites", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);
    const optimizer = join(dir, "optimizer.as");
    writeFileSync(
      optimizer,
      `
      import tool AgentScript from "host://agentscript"

      main agent Optimizer {
        main func(input) {
          return AgentScript.trial({
            target: input.target,
            input: {},
            selection: {
              "worker.as#Worker.main[tone]": "casual"
            },
            trace: "none"
          })
        }
      }
    `,
    );

    const result = await executeAgent(
      loadProgram(optimizer),
      { target },
      { sourcePath: optimizer, workspaceRoot: dir },
    );

    expect(result.value).toMatchObject({
      ok: true,
      picked: {
        "worker.as#Worker.main[tone]": {
          variant: "casual",
          reason: "trial",
          empty: false,
        },
      },
    });
  });

  it("returns soft errors for invalid trial variants", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);

    const result = await runTool(dir, "trial", {
      target,
      input: {},
      selection: {
        "worker.as#Worker.main[tone]": "missing",
      },
      trace: "none",
    });

    expect(result.value).toMatchObject({
      ok: false,
      code: "unknown_variant",
      site_id: "worker.as#Worker.main[tone]",
      variant: "missing",
    });
  });

  it("continues trial with a warning when the snapshot changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);
    const inspected = await runTool(dir, "inspect", { target });
    writeFileSync(join(dir, "worker.as"), readFileSync(join(dir, "worker.as"), "utf8").replace("formal", "strict"));

    const result = await runTool(dir, "trial", {
      target,
      snapshot_id: (inspected.value as { snapshot_id: string }).snapshot_id,
      input: {},
      trace: "none",
    });

    expect(result.value).toMatchObject({
      ok: true,
      warnings: [
        {
          code: "snapshot_mismatch",
        },
      ],
    });
  });

  it("specializes selected candidates without overwriting the source by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);
    const optimizer = join(dir, "optimizer.as");
    const output = join(dir, "optimized");
    writeFileSync(
      optimizer,
      `
      import tool AgentScript from "host://agentscript"

      main agent Optimizer {
        main func(input) {
          return AgentScript.specialize({
            target: input.target,
            output: input.output,
            selection: {
              "worker.as#Worker.main[tone]": "casual"
            }
          })
        }
      }
    `,
    );

    const result = await executeAgent(
      loadProgram(optimizer),
      { target, output },
      { sourcePath: optimizer, workspaceRoot: dir },
    );

    expect(result.value).toMatchObject({ ok: true, changed: true });
    expect(readFileSync(join(output, "worker.as"), "utf8")).toContain("casual: input.casual selected");
    expect(readFileSync(join(dir, "worker.as"), "utf8")).toContain("formal: input.formal selected");
  });

  it("returns soft errors for invalid specialize selections without writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);
    const output = join(dir, "optimized");
    const result = await runTool(dir, "specialize", {
      target,
      output,
      selection: {
        "worker.as#Worker.main[missing]": "casual",
      },
    });

    expect(result.value).toMatchObject({
      ok: false,
      code: "unknown_selection_key",
    });
  });

  it("rejects specialize when the target snapshot changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);
    const inspected = await runTool(dir, "inspect", { target });
    writeFileSync(join(dir, "worker.as"), readFileSync(join(dir, "worker.as"), "utf8").replace("formal", "strict"));

    const result = await runTool(dir, "specialize", {
      target,
      snapshot_id: (inspected.value as { snapshot_id: string }).snapshot_id,
      selection: {
        "worker.as#Worker.main[tone]": "casual",
      },
      write: "preview",
    });

    expect(result.value).toMatchObject({
      ok: false,
      code: "snapshot_mismatch",
    });
  });

  it("supports flatten mode with empty winners", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = join(dir, "target.as");
    writeFileSync(
      target,
      `
      main agent Target {
        main func(input) {
          use one of {
            none: empty
            details: input.details selected
          } as evidence

          return input
        }
      }
    `,
    );

    const result = await runTool(dir, "specialize", {
      target,
      selection: {
        "target.as#Target.main[evidence]": "none",
      },
      mode: "flatten",
      write: "preview",
    });

    expect(result.value).toMatchObject({ ok: true, changed: true });
    expect((result.value as { diff: string }).diff).toContain("-          use one of {");
  });

  it("returns focused preview diff hunks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);

    const result = await runTool(dir, "specialize", {
      target,
      selection: {
        "worker.as#Worker.main[tone]": "casual",
      },
      write: "preview",
    });

    const diff = (result.value as { diff: string }).diff;
    expect(diff).toContain("---");
    expect(diff).toContain("@@");
    expect(diff).toContain("-          formal: input.formal selected");
    expect(diff).toContain("+          casual: input.casual selected");
    expect(diff).not.toContain("agent Worker");
  });

  it("preserves indentation when adding specialize comments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);

    const result = await runTool(dir, "specialize", {
      target,
      selection: {
        "worker.as#Worker.main[tone]": "casual",
      },
      comment: "selected by test",
      write: "preview",
    });

    expect((result.value as { diff: string }).diff).toContain(
      "          // selected by test\n+          casual: input.casual selected",
    );
  });

  it("reports no-op specialize selections as unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-toolchain-"));
    const target = writeTargetGraph(dir);
    const output = join(dir, "optimized");

    const result = await runTool(dir, "specialize", {
      target,
      output,
      selection: {
        "worker.as#Worker.main[tone]": "formal",
      },
    });

    expect(result.value).toMatchObject({
      ok: true,
      changed: false,
      edits: [],
      outputs: [],
      output: null,
    });
    expect(existsSync(output)).toBe(false);
  });
});

async function runTool(dir: string, method: string, args: Record<string, RuntimeValue>) {
  const optimizer = join(dir, `optimizer-${method}.as`);
  writeFileSync(
    optimizer,
    `
    import tool AgentScript from "host://agentscript"

    main agent Optimizer {
      main func(input) {
        return AgentScript.${method}(input)
      }
    }
  `,
  );
  return executeAgent(loadProgram(optimizer), args, { sourcePath: optimizer, workspaceRoot: dir });
}

function writeTargetGraph(dir: string): string {
  const target = join(dir, "main.as");
  writeFileSync(
    join(dir, "worker.as"),
    `
    agent Worker {
      main func(input) {
        use one of {
          formal: input.formal selected
          casual: input.casual
        } as tone

        return input
      }
    }
  `,
  );
  writeFileSync(
    target,
    `
    import agent Worker from "./worker.as"

    main agent App {
      main func(input) {
        use one of {
          brief: "brief" selected
          full: "full"
        } as style

        return Worker(input)
      }
    }
  `,
  );
  return target;
}
