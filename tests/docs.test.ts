import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";

interface CodeBlock {
  file: string;
  line: number;
  code: string;
}

const AGENTSCRIPT_BLOCK = /```agentscript\n([\s\S]*?)```/g;
const DOC_FILES = ["README.md", "README-CN.md", ...globSync("docs/{en,cn}/*.md")].sort();

describe("documentation AgentScript examples", () => {
  it("parses complete AgentScript programs in README and docs", () => {
    const failures: string[] = [];
    const blocks = DOC_FILES.flatMap(readAgentScriptBlocks).filter(isCompleteProgramBlock);

    for (const block of blocks) {
      try {
        parse(block.code);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${block.file}:${block.line}: ${message}`);
      }
    }

    expect(blocks.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});

function readAgentScriptBlocks(file: string): CodeBlock[] {
  const text = readFileSync(file, "utf8");
  const blocks: CodeBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = AGENTSCRIPT_BLOCK.exec(text))) {
    blocks.push({
      file,
      line: text.slice(0, match.index).split("\n").length,
      code: match[1] ?? "",
    });
  }

  return blocks;
}

function isCompleteProgramBlock(block: CodeBlock): boolean {
  const source = block.code.trimStart();
  return /^(\/\/[^\n]*\n\s*)*(import\s|main\s+agent\b|agent\s)/.test(source);
}
