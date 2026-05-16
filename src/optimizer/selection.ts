import { findFunction, requireAgent, resolveEntryAgent, resolveMainFunction } from "../runtime/core/agents.js";
import { RuntimeError } from "../runtime/core/errors.js";
import { isObject } from "../runtime/values/guards.js";
import type { LoadedProgramGraph } from "../runtime/program/loader.js";
import type { RuntimeValue } from "../runtime/values/values.js";
import type { VariantSiteMetadata } from "../language/variant-sites.js";

export interface OptimizerEntry {
  agent: string;
  func?: string;
}

export function readSelection(value: RuntimeValue | undefined): Record<string, string> {
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

export function validateSelection(
  selection: Record<string, string>,
  sites: VariantSiteMetadata[],
): RuntimeValue | undefined {
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

export function readEntry(value: RuntimeValue | undefined): OptimizerEntry | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || Array.isArray(value) || typeof value.agent !== "string") {
    throw new RuntimeError("entry must be an object with an agent string");
  }
  if (value.func !== undefined && typeof value.func !== "string") {
    throw new RuntimeError("entry.func must be a string");
  }
  return { agent: value.agent, func: value.func };
}

export function validateEntry(entry: OptimizerEntry | undefined, graph: LoadedProgramGraph): RuntimeValue | undefined {
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
