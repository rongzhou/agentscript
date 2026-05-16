import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { analyzeSource } from "../architect/analyze.js";
import { compileSpec } from "../architect/compiler/index.js";
import { parseAgentSpecDraft } from "../architect/spec/schema.js";
import { validateSpec, type SpecDiagnostic, type ValidateResult } from "../architect/validator/index.js";
import { MockLlmProvider } from "../providers/mock/llm.js";
import { ProtocolLlmProvider } from "../providers/llm/protocol.js";
import { createDefaultToolProvider } from "../providers/tools/host.js";
import { executeAgent } from "../runtime/interpreter.js";
import { loadProgram } from "../runtime/loader.js";
import { isObject } from "../runtime/guards.js";
import { sanitizeForJson } from "../runtime/json.js";
import type { LlmProvider } from "../runtime/types.js";
import type { ArchitectCliOptions } from "./args.js";

export async function runArchitect(options: ArchitectCliOptions): Promise<number> {
  if (options.mode === "request") {
    return runArchitectRequest(options);
  }
  const spec = readSpecFile(options.specFile);
  const validation = validateSpec(spec);
  if (options.mode === "check") {
    printValidation(validation, options.quiet);
    return validation.ok ? 0 : 1;
  }
  if (!validation.ok) {
    printDiagnostics("AgentSpec validation failed", validation.diagnostics);
    return 1;
  }
  const compiled = compileSpec(spec);
  if (!compiled.ok) {
    printDiagnostics("AgentSpec compilation failed", compiled.diagnostics);
    return 1;
  }
  const analysis = analyzeSource(compiled.source);
  if (!analysis.ok) {
    printDiagnostics("Generated source analysis failed", analysis.diagnostics);
    return 1;
  }
  mkdirSync(dirname(options.outputFile), { recursive: true });
  writeFileSync(options.outputFile, compiled.source);
  if (!options.quiet) {
    console.log(JSON.stringify({ ok: true, output: options.outputFile }, null, 2));
  }
  return 0;
}

async function runArchitectRequest(options: Extract<ArchitectCliOptions, { mode: "request" }>): Promise<number> {
  const sourcePath = "examples/meta/architect.as";
  const llmProvider: LlmProvider = options.mock ? new MockLlmProvider() : new ProtocolLlmProvider();
  const toolProvider = createDefaultToolProvider(process.cwd());
  const result = await executeAgent(
    loadProgram(sourcePath),
    {
      request: options.request,
      target_name: targetNameFromOutput(options.outputFile),
      model_uri: options.modelUri,
    },
    {
      llmProvider,
      toolProvider,
      sourcePath,
      workspaceRoot: process.cwd(),
    },
  ).finally(async () => {
    await llmProvider.close?.();
    await toolProvider.close?.();
  });
  const value = sanitizeForJson(result.value);
  if (isObject(value) && value.analysis_ok === true && typeof value.source === "string" && value.source.length > 0) {
    mkdirSync(dirname(options.outputFile), { recursive: true });
    writeFileSync(options.outputFile, value.source);
    if (!options.quiet) console.log(JSON.stringify({ ok: true, output: options.outputFile, value }, null, 2));
    return 0;
  }
  console.error("Architect request did not produce analyzable source:");
  console.error(JSON.stringify(value, null, 2));
  return 1;
}

function readSpecFile(path: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read AgentSpec '${path}': ${error instanceof Error ? error.message : String(error)}`);
  }
  const draft = parseAgentSpecDraft(parsed);
  if (!draft) throw new Error(`AgentSpec '${path}' must contain a JSON object`);
  return draft;
}

function printValidation(result: ValidateResult, quiet: boolean): void {
  if (result.ok) {
    if (!quiet) console.log(JSON.stringify(result, null, 2));
    return;
  }
  printDiagnostics("AgentSpec validation failed", result.diagnostics);
}

function printDiagnostics(header: string, diagnostics: SpecDiagnostic[]): void {
  console.error(`${header}:`);
  console.error(JSON.stringify(diagnostics, null, 2));
}

function targetNameFromOutput(outputFile: string): string {
  const stem = basename(outputFile).replace(/\.[^.]+$/, "");
  const parts = stem.split(/[^A-Za-z0-9_]+/).filter(Boolean);
  const name = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("") || "GeneratedAgent";
  return /^[A-Z]/.test(name) ? name : `Agent${name}`;
}
