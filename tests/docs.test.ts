import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { analyze } from "../src/semantic/analyzer.js";

interface CodeBlock {
  file: string;
  line: number;
  code: string;
}

const AGENTSCRIPT_BLOCK = /```agentscript\n([\s\S]*?)```/g;
const HTML_SRC = /\bsrc=["']([^"']+)["']/g;
const MARKDOWN_LINK_OR_IMAGE = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const DOC_FILES = ["README.md", "README-CN.md", ...globSync("docs/{en,cn}/**/*.md")].sort();
const SEMANTIC_DOC_FILES = ["README.md", "README-CN.md"];

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

  it("semantically checks complete AgentScript programs in README and docs", () => {
    const failures: string[] = [];
    const blocks = SEMANTIC_DOC_FILES.flatMap(readAgentScriptBlocks).filter(isSelfContainedProgramBlock);

    for (const block of blocks) {
      try {
        const result = analyze(parse(block.code));
        for (const diagnostic of result.diagnostics.filter((item) => item.severity === "error")) {
          failures.push(`${block.file}:${block.line}: ${diagnostic.code}: ${diagnostic.message}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${block.file}:${block.line}: ${message}`);
      }
    }

    expect(blocks.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it("keeps local documentation links and images valid", () => {
    const failures: string[] = [];

    for (const file of DOC_FILES) {
      for (const target of readLocalTargets(file)) {
        const resolved = normalize(join(dirname(file), target.path));
        if (!existsSync(resolved)) {
          failures.push(`${file}:${target.line}: missing ${target.raw}`);
        }
      }
    }

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

function isSelfContainedProgramBlock(block: CodeBlock): boolean {
  const source = block.code;
  return isCompleteProgramBlock(block) && /^\/\/\s*(examples|tutorials|recipes)\//.test(source.trimStart());
}

function readLocalTargets(file: string): Array<{ line: number; path: string; raw: string }> {
  const text = readFileSync(file, "utf8");
  const targets: Array<{ line: number; path: string; raw: string }> = [];

  for (const regex of [MARKDOWN_LINK_OR_IMAGE, HTML_SRC]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const raw = match[1] ?? "";
      const path = localPath(raw);
      if (path) {
        targets.push({
          line: text.slice(0, match.index).split("\n").length,
          path,
          raw,
        });
      }
    }
  }

  return targets;
}

function localPath(rawTarget: string): string | null {
  const target = rawTarget.replace(/^<|>$/g, "");
  if (target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return null;
  }

  const [path] = target.split("#");
  if (!path) {
    return null;
  }

  return decodeURIComponent(path);
}
