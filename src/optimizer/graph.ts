import { resolve } from "node:path";
import {
  ENV_SCHEME,
  FILE_SCHEME,
  HTTP_SCHEME,
  HTTPS_SCHEME,
  MCP_SCHEME,
  NODE_SCHEME,
  NPM_SCHEME,
  OPTIMIZER_SCHEME,
  SHELL_SCHEME,
} from "../language/schemes.js";
import { normalizeTargetPath } from "../language/site-id.js";
import { uriScheme } from "../language/uri.js";
import { collectVariantSites, type VariantSiteMetadata } from "../language/variant-sites.js";
import { loadProgramGraph, type LoadedProgramGraph } from "../runtime/loader.js";
import type { JsonValue } from "../runtime/types.js";
import { analyze } from "../semantic/analyzer.js";
import type { SemanticDiagnostic } from "../semantic/diagnostics.js";
import type { OptimizerToolContext } from "./context.js";

export function readTargetGraph(target: string): LoadedProgramGraph {
  return loadProgramGraph(resolve(target));
}

export function semanticErrors(graph: LoadedProgramGraph): SemanticDiagnostic[] {
  return analyze(graph.program).diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

export function collectGraphSites(graph: LoadedProgramGraph, ctx: OptimizerToolContext): VariantSiteMetadata[] {
  return collectVariantSites(graph.program, { sourcePath: graph.entryPath, workspaceRoot: ctx.workspaceRoot });
}

export function normalizePath(path: string | undefined, ctx: OptimizerToolContext): string {
  return normalizeTargetPath(path, ctx.workspaceRoot);
}

export function targetEffectfulToolWarnings(graph: LoadedProgramGraph): JsonValue[] {
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
      return new URL(uri).hostname !== OPTIMIZER_SCHEME;
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
