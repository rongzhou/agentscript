import { budgetToJson, sanitizeForJson } from "../runtime/values/json.js";
import type { JsonObject, JsonValue, RuntimeValue } from "../runtime/values/values.js";
import type { ToolCallRequest } from "../runtime/values/providers.js";
import type { VariantSiteMetadata } from "../language/variant-sites.js";
import { expectObject, readRequiredString } from "../providers/tools/shared.js";
import type { OptimizerToolContext } from "./context.js";
import {
  collectGraphSites,
  normalizePath,
  readTargetGraph,
  semanticErrors,
  targetEffectfulToolWarnings,
} from "./graph.js";
import { snapshotGraph } from "./snapshot.js";

export function inspectOptimizer(request: ToolCallRequest, ctx: OptimizerToolContext): RuntimeValue {
  const args = expectObject(request.args[0], "Optimizer.inspect");
  const graph = readTargetGraph(readRequiredString(args.target, "target"));
  const diagnostics = semanticErrors(graph);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      code: "semantic_error",
      target: normalizePath(graph.entryPath, ctx),
      diagnostics: sanitizeForJson(diagnostics),
    };
  }
  const sites = collectGraphSites(graph, ctx);
  const warnings: JsonValue[] = [];
  if (sites.length === 0) warnings.push({ code: "no_variant_sites" });
  warnings.push(...targetEffectfulToolWarnings(graph));
  return {
    ok: true,
    target: normalizePath(graph.entryPath, ctx),
    snapshot_id: snapshotGraph(graph, ctx),
    files: graph.files.map((file) => normalizePath(file.path, ctx)).sort(),
    variant_sites: sites.map(siteToJson),
    baseline_selection: baselineSelection(sites),
    warnings,
  };
}

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
