import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/bin/args.js";

describe("CLI argument parsing", () => {
  it("parses optimizer mode as a structured option", () => {
    const options = parseArgs([
      "examples/optimizer/optimizer.as",
      "examples/optimizer/triage.as",
      "--write",
      "preview",
      "--no-cache",
      "--max-trials",
      "3",
    ]);

    expect(options.command).toBe("run");
    expect(options.maxTrials).toBe(3);
    expect(options.optimizer).toEqual({
      targetFile: "examples/optimizer/triage.as",
      args: {
        write: "preview",
        cache: false,
      },
    });
  });

  it("rejects optimizer-only options outside optimizer mode", () => {
    expect(() => parseArgs(["examples/docs.as", "--write", "preview"])).toThrow("Unknown option '--write'");
  });

  it("parses architect mode as a discriminated option", () => {
    expect(parseArgs(["architect", "--check", "agent.spec.json"]).architect).toEqual({
      mode: "check",
      specFile: "agent.spec.json",
      mock: false,
      quiet: false,
    });
  });
});
