import type { AgentDecl, Program, SourceRange } from "../ast/types.js";
import { type BindingKind, importResourceKindToBindingKind } from "../language/bindings.js";
import { defaultEntryAgent } from "../language/entry.js";
import { NODE_SCHEME, NPM_SCHEME } from "../language/schemes.js";
import { uriScheme } from "../language/uri.js";
import { checkNodeImport, checkNpmImport, type NpmRegistry } from "../providers/tools/npm-registry.js";
import { errorDiagnostic, type SemanticDiagnostic } from "./diagnostics.js";

export interface ProgramAnalyzeOptions {
  npmRegistry?: NpmRegistry;
}

export interface ImportBindingDecl {
  kind: BindingKind;
  range: SourceRange;
  uri: string;
}

export interface ProgramDeclarations {
  agentDecls: Map<string, AgentDecl>;
  importBindings: Map<string, ImportBindingDecl>;
  diagnostics: SemanticDiagnostic[];
}

export function collectProgramDeclarations(program: Program, options: ProgramAnalyzeOptions = {}): ProgramDeclarations {
  const diagnostics: SemanticDiagnostic[] = [];
  const importBindings = collectImportBindings(program, options, diagnostics);
  const agentDecls = collectAgentBindings(program, importBindings, diagnostics);

  return {
    agentDecls,
    importBindings,
    diagnostics,
  };
}

function collectImportBindings(
  program: Program,
  options: ProgramAnalyzeOptions,
  diagnostics: SemanticDiagnostic[],
): Map<string, ImportBindingDecl> {
  const importBindings = new Map<string, ImportBindingDecl>();
  for (const imported of program.imports) {
    if (importBindings.has(imported.name)) {
      diagnostics.push(errorDiagnostic("DUPLICATE_IMPORT", `Duplicate import '${imported.name}'`, imported.range));
      continue;
    }
    const kind = importResourceKindToBindingKind(imported.resourceKind);
    importBindings.set(imported.name, { kind, range: imported.range, uri: imported.uri });
    if (imported.resourceKind === "tool") {
      checkToolImportAuthorization(imported.uri, imported.range, options, diagnostics);
    }
  }
  return importBindings;
}

function checkToolImportAuthorization(
  uri: string,
  range: SourceRange,
  options: ProgramAnalyzeOptions,
  diagnostics: SemanticDiagnostic[],
): void {
  if (!options.npmRegistry) return;
  try {
    if (uriScheme(uri) === NPM_SCHEME) {
      checkNpmImport(uri, options.npmRegistry);
    } else if (uriScheme(uri) === NODE_SCHEME) {
      checkNodeImport(uri, options.npmRegistry);
    }
  } catch (error) {
    diagnostics.push(
      errorDiagnostic("UNAUTHORIZED_TOOL_IMPORT", error instanceof Error ? error.message : String(error), range),
    );
  }
}

function collectAgentBindings(
  program: Program,
  importBindings: Map<string, ImportBindingDecl>,
  diagnostics: SemanticDiagnostic[],
): Map<string, AgentDecl> {
  const agentDecls = new Map<string, AgentDecl>();
  let mainAgent: AgentDecl | undefined;
  const seenNames = new Set<string>();

  for (const agent of program.agents) {
    if (seenNames.has(agent.name)) {
      diagnostics.push(errorDiagnostic("DUPLICATE_AGENT", `Duplicate agent '${agent.name}'`, agent.range));
    }
    seenNames.add(agent.name);
    agentDecls.set(agent.name, agent);
    if (agent.isMain) {
      if (mainAgent) {
        diagnostics.push(errorDiagnostic("DUPLICATE_MAIN_AGENT", "Program can only have one main agent", agent.range));
      }
      mainAgent = agent;
    }
  }

  if (!mainAgent && program.agents.length > 1) {
    diagnostics.push(
      errorDiagnostic("MISSING_MAIN_AGENT", "Program with multiple agents must declare one main agent", program.range),
    );
  }

  for (const agent of program.agents) {
    const imported = importBindings.get(agent.name);
    if (imported) {
      diagnostics.push(
        errorDiagnostic(
          "DUPLICATE_BINDING",
          `Agent '${agent.name}' conflicts with an imported ${imported.kind}`,
          agent.range,
        ),
      );
    }
  }

  const entryAgent = defaultEntryAgent(program);
  if (entryAgent && !entryAgent.functions.some((fn) => fn.isMain)) {
    diagnostics.push(errorDiagnostic("MISSING_MAIN_FUNC", "Entry agent must declare one main func", entryAgent.range));
  }

  return agentDecls;
}
