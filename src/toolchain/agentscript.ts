import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findFunction, requireAgent, resolveEntryAgent, resolveMainFunction } from "../runtime/agents.js";
import { RuntimeError } from "../runtime/errors.js";
import { isObject } from "../runtime/guards.js";
import { executeAgent } from "../runtime/interpreter.js";
import { budgetToJson, sanitizeForJson } from "../runtime/json.js";
import { loadProgramGraph, type LoadedProgramGraph } from "../runtime/loader.js";
import { normalizeTargetPath } from "../language/site-id.js";
import {
  AGENTSCRIPT_SCHEME,
  ENV_SCHEME,
  FILE_SCHEME,
  HTTP_SCHEME,
  HTTPS_SCHEME,
  MCP_SCHEME,
  NODE_SCHEME,
  NPM_SCHEME,
  SHELL_SCHEME,
} from "../language/schemes.js";
import { uriScheme } from "../language/uri.js";
import type {
  JsonObject,
  JsonValue,
  LlmProvider,
  MemoryProvider,
  RuntimeValue,
  ToolCallRequest,
  ToolProvider,
  TraceEvent,
} from "../runtime/types.js";
import { analyze } from "../semantic/analyzer.js";
import type { SemanticDiagnostic } from "../semantic/diagnostics.js";
import { collectVariantSites, type VariantSiteMetadata } from "../language/variant-sites.js";
import { expectObject, readOptionalString, readRequiredString } from "../providers/tools/shared.js";
import { outputTarget, rewriteGraph, writeRewrite } from "./source-rewrite.js";

export interface AgentscriptToolContext {
  workspaceRoot: string;
  artifactsDir?: string;
  budget?: AgentscriptBudgetCounter;
  llmProvider?: LlmProvider;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
}

interface AgentscriptBudgetCounter {
  incrementTrial(): void;
  incrementLlm(): void;
  checkDeadline(): void;
}

export class AgentscriptToolProvider implements ToolProvider {
  private trialCounter = 0;

  constructor(private readonly ctx: AgentscriptToolContext) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (new URL(request.uri).pathname.replace(/^\/$/, "") !== "") {
      return softError("invalid_uri", "host://agentscript does not accept a path");
    }
    switch (request.method) {
      case "inspect":
        return this.inspect(request);
      case "trial":
        return this.trial(request);
      case "specialize":
        return this.specialize(request);
      default:
        throw new RuntimeError(`Unknown AgentScript method '${request.method}'`);
    }
  }

  private inspect(request: ToolCallRequest): RuntimeValue {
    const args = expectObject(request.args[0], "AgentScript.inspect");
    const graph = readTargetGraph(readRequiredString(args.target, "target"));
    const diagnostics = semanticErrors(graph);
    if (diagnostics.length > 0) {
      return {
        ok: false,
        code: "semantic_error",
        target: normalizePath(graph.entryPath, this.ctx),
        diagnostics: sanitizeForJson(diagnostics),
      };
    }
    const sites = collectGraphSites(graph, this.ctx);
    const warnings: JsonValue[] = [];
    if (sites.length === 0) warnings.push({ code: "no_variant_sites" });
    warnings.push(...targetEffectfulToolWarnings(graph));
    return {
      ok: true,
      target: normalizePath(graph.entryPath, this.ctx),
      snapshot_id: snapshotGraph(graph, this.ctx),
      files: graph.files.map((file) => normalizePath(file.path, this.ctx)).sort(),
      variant_sites: sites.map(siteToJson),
      baseline_selection: baselineSelection(sites),
      warnings,
    };
  }

  private async trial(request: ToolCallRequest): Promise<RuntimeValue> {
    const args = expectObject(request.args[0], "AgentScript.trial");
    const target = readRequiredString(args.target, "target");
    const graph = readTargetGraph(target);
    const warnings: JsonValue[] = [];
    const expectedSnapshot = readOptionalString(args.snapshot_id);
    const actualSnapshot = snapshotGraph(graph, this.ctx);
    if (expectedSnapshot && expectedSnapshot !== actualSnapshot) {
      warnings.push({ code: "snapshot_mismatch", expected: expectedSnapshot, actual: actualSnapshot });
    }
    const diagnostics = semanticErrors(graph);
    if (diagnostics.length > 0) {
      return {
        ok: false,
        code: "semantic_error",
        target: normalizePath(graph.entryPath, this.ctx),
        diagnostics: sanitizeForJson(diagnostics),
      };
    }
    const sites = collectGraphSites(graph, this.ctx);
    const selection = readSelection(args.selection);
    const selectionError = validateSelection(selection, sites);
    if (selectionError) return selectionError;
    const entry = readEntry(args.entry);
    const entryError = validateEntry(entry, graph);
    if (entryError) return entryError;
    const traceMode = readTraceMode(args.trace);
    this.ctx.budget?.incrementTrial();
    this.ctx.budget?.checkDeadline();

    try {
      const start = Date.now();
      const result = await executeAgent(graph.program, args.input ?? {}, {
        agentName: entry?.agent,
        functionName: entry?.func,
        llmProvider: this.ctx.llmProvider,
        toolProvider: this.ctx.toolProvider,
        memoryProvider: this.ctx.memoryProvider,
        sourcePath: graph.entryPath,
        workspaceRoot: this.ctx.workspaceRoot,
        variant: selection,
        closeProviders: false,
      });
      const picked = pickedVariants(result.trace);
      const unreached = Object.keys(selection).filter((siteId) => !(siteId in picked));
      const traceRef =
        traceMode === "none" ? null : this.writeTrialTrace(result.trace, readOptionalString(args.run_id));
      return {
        ok: true,
        result: sanitizeForJson(result.value),
        usage: {
          prompt_tokens: null,
          output_tokens: null,
          total_tokens: null,
          llm_calls: countEvents(result.trace, "generate"),
          latency_ms: Date.now() - start,
        },
        picked,
        unreached_selection: unreached,
        warnings,
        trace: traceMode === "full" ? sanitizeForJson(result.trace) : null,
        trace_ref: traceRef,
      };
    } catch (error) {
      if (isBudgetExceeded(error)) throw error;
      return softError("target_runtime_error", error instanceof Error ? error.message : String(error));
    }
  }

  private specialize(request: ToolCallRequest): RuntimeValue {
    const args = expectObject(request.args[0], "AgentScript.specialize");
    const target = readRequiredString(args.target, "target");
    const graph = readTargetGraph(target);
    const expectedSnapshot = readOptionalString(args.snapshot_id);
    const actualSnapshot = snapshotGraph(graph, this.ctx);
    if (expectedSnapshot && expectedSnapshot !== actualSnapshot) {
      return { ok: false, code: "snapshot_mismatch", expected: expectedSnapshot, actual: actualSnapshot };
    }
    const diagnostics = semanticErrors(graph);
    if (diagnostics.length > 0) {
      return {
        ok: false,
        code: "semantic_error",
        target: normalizePath(graph.entryPath, this.ctx),
        diagnostics: sanitizeForJson(diagnostics),
      };
    }
    const sites = collectGraphSites(graph, this.ctx);
    const selection = readSelection(args.selection);
    const selectionError = validateSelection(selection, sites);
    if (selectionError) return selectionError;
    const fillMissing = readOptionalString(args.fill_missing) ?? "source_default";
    if (fillMissing !== "source_default" && fillMissing !== "require") {
      throw new RuntimeError("fill_missing must be 'source_default' or 'require'");
    }
    if (fillMissing === "require") {
      const missing = sites.map((site) => site.siteId).filter((siteId) => !(siteId in selection));
      if (missing.length > 0) return { ok: false, code: "incomplete_selection", missing_sites: missing };
    }
    const mode = readOptionalString(args.mode) ?? "structure-preserving";
    if (mode !== "structure-preserving" && mode !== "flatten") {
      throw new RuntimeError("mode must be 'structure-preserving' or 'flatten'");
    }
    const writeMode = readOptionalString(args.write) ?? "copy";
    if (writeMode !== "preview" && writeMode !== "copy" && writeMode !== "in_place") {
      throw new RuntimeError("write must be 'preview', 'copy', or 'in_place'");
    }

    const rewrite = rewriteGraph(
      graph,
      sites,
      selection,
      mode,
      readOptionalString(args.comment),
      this.ctx.workspaceRoot,
    );
    const output = outputTarget(graph, readOptionalString(args.output), writeMode);
    const changed = rewrite.edits.length > 0;
    const outputs = !changed
      ? []
      : writeMode === "preview"
        ? rewrite.changedFiles.map((file) => normalizePath(file.path, this.ctx))
        : writeRewrite(rewrite, output, writeMode, this.ctx.workspaceRoot);
    return {
      ok: true,
      changed,
      output: !changed || writeMode === "preview" ? null : output.display,
      outputs,
      diff: rewrite.diff,
      edits: rewrite.edits,
      snapshot_id: actualSnapshot,
    };
  }

  private writeTrialTrace(trace: TraceEvent[], runId: string | undefined): string | null {
    if (!this.ctx.artifactsDir) return null;
    const dir = join(this.ctx.artifactsDir, "trials");
    mkdirSync(dir, { recursive: true });
    const name = `${runId ?? "run"}-${Date.now()}-${this.trialCounter++}.jsonl`;
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(sanitizeForJson(trace))}\n`);
    return normalizeTargetPath(path, this.ctx.workspaceRoot);
  }
}

function readTargetGraph(target: string): LoadedProgramGraph {
  return loadProgramGraph(resolve(target));
}

function semanticErrors(graph: LoadedProgramGraph): SemanticDiagnostic[] {
  return analyze(graph.program).diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

function collectGraphSites(graph: LoadedProgramGraph, ctx: AgentscriptToolContext): VariantSiteMetadata[] {
  return collectVariantSites(graph.program, { sourcePath: graph.entryPath, workspaceRoot: ctx.workspaceRoot });
}

function targetEffectfulToolWarnings(graph: LoadedProgramGraph): JsonValue[] {
  const warnings: JsonValue[] = [];
  const seen = new Set<string>();
  for (const imported of graph.program.imports) {
    if (imported.resourceKind !== "tool" || !isTargetEffectfulToolImport(imported.uri)) continue;
    const key = `${imported.name}\0${imported.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push({
      code: "target_effectful_tool",
      tool: imported.name,
      uri: imported.uri,
    });
  }
  return warnings;
}

function isTargetEffectfulToolImport(uri: string): boolean {
  const scheme = uriScheme(uri);
  if (scheme === "host") {
    try {
      return new URL(uri).hostname !== AGENTSCRIPT_SCHEME;
    } catch {
      return true;
    }
  }
  return EFFECTFUL_TARGET_TOOL_SCHEMES.has(scheme);
}

const EFFECTFUL_TARGET_TOOL_SCHEMES = new Set([
  ENV_SCHEME,
  FILE_SCHEME,
  HTTP_SCHEME,
  HTTPS_SCHEME,
  MCP_SCHEME,
  NODE_SCHEME,
  NPM_SCHEME,
  SHELL_SCHEME,
]);

function siteToJson(site: VariantSiteMetadata): JsonObject {
  return {
    site_id: site.siteId,
    label: site.label,
    scope: sanitizeForJson(site.scope) as JsonObject,
    selected: site.selected,
    default_reason: site.defaultReason,
    candidates: site.candidates.map((candidate) => ({
      name: candidate.name,
      empty: candidate.empty,
      budget: budgetToJson(candidate.budget),
    })),
  };
}

function baselineSelection(sites: VariantSiteMetadata[]): JsonObject {
  const selection: JsonObject = {};
  for (const site of sites) {
    selection[site.siteId] = site.selected ?? site.candidates[0]?.name ?? "";
  }
  return selection;
}

function snapshotGraph(graph: LoadedProgramGraph, ctx: AgentscriptToolContext): string {
  const hash = createHash("sha256");
  for (const file of [...graph.files].sort((a, b) =>
    normalizePath(a.path, ctx).localeCompare(normalizePath(b.path, ctx)),
  )) {
    hash.update(normalizePath(file.path, ctx));
    hash.update("\0");
    hash.update(normalizeSource(file.source));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function normalizeSource(source: string): string {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC");
}

function normalizePath(path: string | undefined, ctx: AgentscriptToolContext): string {
  return normalizeTargetPath(path, ctx.workspaceRoot);
}

function readSelection(value: RuntimeValue | undefined): Record<string, string> {
  if (value === undefined) return {};
  if (!isObject(value) || Array.isArray(value)) {
    throw new RuntimeError("selection must be an object");
  }
  const selection: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new RuntimeError("selection values must be strings");
    selection[key] = item;
  }
  return selection;
}

function validateSelection(selection: Record<string, string>, sites: VariantSiteMetadata[]): RuntimeValue | undefined {
  const byId = new Map(sites.map((site) => [site.siteId, site]));
  for (const [siteId, variant] of Object.entries(selection)) {
    const site = byId.get(siteId);
    if (!site) return { ok: false, code: "unknown_selection_key", site_id: siteId };
    if (!site.candidates.some((candidate) => candidate.name === variant)) {
      return { ok: false, code: "unknown_variant", site_id: siteId, variant };
    }
  }
  return undefined;
}

function readEntry(value: RuntimeValue | undefined): { agent: string; func?: string } | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || Array.isArray(value) || typeof value.agent !== "string") {
    throw new RuntimeError("entry must be an object with an agent string");
  }
  if (value.func !== undefined && typeof value.func !== "string") {
    throw new RuntimeError("entry.func must be a string");
  }
  return { agent: value.agent, func: value.func };
}

function validateEntry(
  entry: { agent: string; func?: string } | undefined,
  graph: LoadedProgramGraph,
): RuntimeValue | undefined {
  try {
    const agents = new Map(graph.program.agents.map((agent) => [agent.name, agent]));
    const agent = entry ? requireAgent(agents, entry.agent) : resolveEntryAgent(graph.program);
    const fn = entry?.func ? findFunction(agent, entry.func) : resolveMainFunction(agent);
    if (!fn) return { ok: false, code: "unknown_entry", agent: agent.name, func: entry?.func ?? null };
    return undefined;
  } catch (error) {
    return { ok: false, code: "unknown_entry", message: error instanceof Error ? error.message : String(error) };
  }
}

function readTraceMode(value: RuntimeValue | undefined): "summary" | "full" | "none" {
  if (value === undefined) return "summary";
  if (value === "summary" || value === "full" || value === "none") return value;
  throw new RuntimeError("trace must be 'summary', 'full', or 'none'");
}

function pickedVariants(trace: TraceEvent[]): JsonObject {
  const picked: JsonObject = {};
  for (const event of flattenTrace(trace)) {
    const variant = isObject(event.data.variant) ? event.data.variant : undefined;
    if (!variant || typeof variant.site_id !== "string" || typeof variant.picked !== "string") continue;
    picked[variant.site_id] = {
      variant: variant.picked,
      reason: typeof variant.reason === "string" ? variant.reason : "first",
      empty: typeof variant.empty === "boolean" ? variant.empty : false,
    };
  }
  return picked;
}

function flattenTrace(trace: TraceEvent[]): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const event of trace) {
    events.push(event);
    const nested = event.data.trace;
    if (Array.isArray(nested)) events.push(...flattenTrace(nested as unknown as TraceEvent[]));
    const iterations = event.data.iterations;
    if (Array.isArray(iterations)) {
      for (const iteration of iterations) {
        if (isObject(iteration) && Array.isArray(iteration.trace)) {
          events.push(...flattenTrace(iteration.trace as unknown as TraceEvent[]));
        }
      }
    }
  }
  return events;
}

function countEvents(trace: TraceEvent[], kind: TraceEvent["kind"]): number {
  return flattenTrace(trace).filter((event) => event.kind === kind).length;
}

function softError(code: string, message: string): JsonObject {
  return { ok: false, code, message };
}

function isBudgetExceeded(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("BUDGET_EXCEEDED:");
}
