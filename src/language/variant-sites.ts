import type { AgentDecl, Budget, FuncDecl, Program, Stmt, UseOneOfCandidate, UseOneOfStmt } from "../ast/types.js";
import { ANONYMOUS_MAIN_AGENT, ANONYMOUS_MAIN_FUNC } from "./entry.js";
import { buildSiteId, type SiteIdContext } from "./site-id.js";
import { getNodeSourcePath } from "./source-map.js";

interface VariantCandidateMetadata {
  node: UseOneOfCandidate;
  name: string;
  empty: boolean;
  budget?: Budget;
  selected: boolean;
}

export interface VariantSiteMetadata {
  node: UseOneOfStmt;
  siteId: string;
  sourcePath?: string;
  label: string;
  scope: { kind: "agent" | "function"; agent: string; func?: string };
  ordinal: number;
  selected: string | null;
  defaultReason: "selected" | "first";
  candidates: VariantCandidateMetadata[];
}

export interface CollectVariantSitesOptions {
  sourcePath?: string;
  workspaceRoot?: string;
}

export function collectVariantSites(program: Program, options: CollectVariantSitesOptions = {}): VariantSiteMetadata[] {
  const sites: VariantSiteMetadata[] = [];
  const ordinals = new Map<string, number>();

  for (const agent of program.agents) {
    for (const use of agent.uses) {
      if (use.kind === "UseOneOfStmt") {
        sites.push(collectSite(use, agent, undefined, options, ordinals));
      }
    }
    for (const fn of agent.functions) {
      collectStatementSites(fn.body, agent, fn, options, ordinals, sites);
    }
  }

  return sites;
}

function collectStatementSites(
  statements: Stmt[],
  agent: AgentDecl,
  fn: FuncDecl,
  options: CollectVariantSitesOptions,
  ordinals: Map<string, number>,
  sites: VariantSiteMetadata[],
): void {
  for (const stmt of statements) {
    switch (stmt.kind) {
      case "UseOneOfStmt":
        sites.push(collectSite(stmt, agent, fn, options, ordinals));
        break;
      case "IfStmt":
        collectStatementSites(stmt.thenBody, agent, fn, options, ordinals, sites);
        if (stmt.elseBody) collectStatementSites(stmt.elseBody, agent, fn, options, ordinals, sites);
        break;
      case "ForInStmt":
      case "LoopUntilStmt":
      case "RepeatStmt":
        collectStatementSites(stmt.body, agent, fn, options, ordinals, sites);
        break;
      case "ExprStmt":
        if (stmt.expr.kind === "ParallelForExpr") {
          collectStatementSites(stmt.expr.body, agent, fn, options, ordinals, sites);
        }
        break;
      case "AssignStmt":
        if (stmt.value.kind === "ParallelForExpr") {
          collectStatementSites(stmt.value.body, agent, fn, options, ordinals, sites);
        }
        break;
      case "ReturnStmt":
        if (stmt.value.kind === "ParallelForExpr") {
          collectStatementSites(stmt.value.body, agent, fn, options, ordinals, sites);
        }
        break;
      case "ConfigDecl":
      case "UseStmt":
        break;
    }
  }
}

function collectSite(
  stmt: UseOneOfStmt,
  agent: AgentDecl,
  fn: FuncDecl | undefined,
  options: CollectVariantSitesOptions,
  ordinals: Map<string, number>,
): VariantSiteMetadata {
  const sourcePath = getNodeSourcePath(stmt) ?? getNodeSourcePath(agent) ?? options.sourcePath;
  const agentName = displayAgentName(agent);
  const funcName = fn ? displayFunctionName(fn) : undefined;
  const ordinalKey = `${sourcePath ?? "<memory>"}\0${agentName}\0${funcName ?? ""}\0${stmt.label}`;
  const ordinal = (ordinals.get(ordinalKey) ?? 0) + 1;
  ordinals.set(ordinalKey, ordinal);

  const selectedCandidate = stmt.candidates.find((candidate) => candidate.selected);
  const siteIdContext: SiteIdContext = {
    sourcePath,
    workspaceRoot: options.workspaceRoot,
    agentName,
    funcName,
    label: stmt.label,
    ordinal,
  };

  return {
    node: stmt,
    siteId: buildSiteId(siteIdContext),
    sourcePath,
    label: stmt.label,
    scope: fn ? { kind: "function", agent: agentName, func: funcName } : { kind: "agent", agent: agentName },
    ordinal,
    selected: selectedCandidate?.name ?? null,
    defaultReason: selectedCandidate ? "selected" : "first",
    candidates: stmt.candidates.map((candidate) => ({
      node: candidate,
      name: candidate.name,
      empty: !candidate.value,
      budget: candidate.budget,
      selected: candidate.selected,
    })),
  };
}

function displayAgentName(agent: AgentDecl): string {
  return agent.name === ANONYMOUS_MAIN_AGENT ? "main" : agent.name;
}

function displayFunctionName(fn: FuncDecl): string {
  return fn.name === ANONYMOUS_MAIN_FUNC ? "main" : fn.name;
}
