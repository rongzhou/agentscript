import type { Program } from "../ast/types.js";
import { analyze, assertSemanticallyValid, type AnalyzeOptions } from "../semantic/analyzer.js";
import type { SemanticResult } from "../semantic/diagnostics.js";
import { loadNpmRegistry } from "../providers/tools/npm-registry.js";

export function cliAnalyzeOptions(): AnalyzeOptions {
  return { npmRegistry: loadNpmRegistry(process.cwd()) };
}

export function analyzeCliProgram(program: Program): SemanticResult {
  return analyze(program, cliAnalyzeOptions());
}

export function assertCliProgramSemanticallyValid(program: Program): SemanticResult {
  return assertSemanticallyValid(program, cliAnalyzeOptions());
}
