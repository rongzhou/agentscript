import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentDecl, ImportDecl, NodeBase, Program } from "../ast/types.js";
import { FILE_SCHEME, SQLITE_SCHEME, schemePrefix } from "../language/schemes.js";
import { parse } from "../parser/parser.js";
import { splitSqliteUri } from "../language/uri.js";
import { setAgentSourcePath, setNodeSourcePath } from "../language/source-map.js";

export interface LoadProgramOptions {
  sourcePath?: string;
}

interface LoadState {
  agentImportKeys: Set<string>;
  importedAgentKeys: Set<string>;
  imports: ImportDecl[];
  importKeys: Set<string>;
  loadingFiles: Set<string>;
  programs: Map<string, LoadedSourceFile>;
  agents: AgentDecl[];
}

export interface LoadedSourceFile {
  path: string;
  source: string;
  program: Program;
}

export interface LoadedProgramGraph {
  entryPath?: string;
  entryProgram: Program;
  program: Program;
  files: LoadedSourceFile[];
}

export function loadProgram(path: string): Program {
  return loadProgramGraph(path).program;
}

export function loadProgramGraph(path: string): LoadedProgramGraph {
  const entryPath = resolve(path);
  const state = createLoadState();
  const entryProgram = readProgram(entryPath, state);
  mergeEntryProgram(entryProgram, dirname(entryPath), state);
  return {
    entryPath,
    entryProgram,
    program: loadedProgram(entryProgram, state),
    files: [...state.programs.values()].map((file) => ({
      path: file.path,
      source: file.source,
      program: file.program,
    })),
  };
}

export function loadProgramSource(source: string, options: LoadProgramOptions = {}): Program {
  return loadProgramSourceGraph(source, options).program;
}

export function loadProgramSourceGraph(source: string, options: LoadProgramOptions = {}): LoadedProgramGraph {
  const sourcePath = options.sourcePath ? resolve(options.sourcePath) : undefined;
  const state = createLoadState();
  const program = parseSource(source, sourcePath);
  if (sourcePath) {
    state.programs.set(sourcePath, { path: sourcePath, source, program });
  }
  const baseDir = sourceBaseDir(program, sourcePath);
  mergeEntryProgram(program, baseDir, state);
  return {
    entryPath: sourcePath,
    entryProgram: program,
    program: loadedProgram(program, state),
    files:
      sourcePath === undefined
        ? [{ path: "<memory>", source, program }]
        : [...state.programs.values()].map((file) => ({
            path: file.path,
            source: file.source,
            program: file.program,
          })),
  };
}

function sourceBaseDir(program: Program, sourcePath: string | undefined): string {
  if (sourcePath) {
    return dirname(sourcePath);
  }
  ensureNoRelativeImports(program);
  return process.cwd();
}

function ensureNoRelativeImports(program: Program): void {
  for (const imported of program.imports) {
    if (requiresFileResolution(imported) && isRelativeImport(imported.uri)) {
      throw new Error(`sourcePath is required to resolve relative ${imported.resourceKind} import '${imported.uri}'`);
    }
  }
}

function createLoadState(): LoadState {
  return {
    agentImportKeys: new Set(),
    importedAgentKeys: new Set(),
    imports: [],
    importKeys: new Set(),
    loadingFiles: new Set(),
    programs: new Map(),
    agents: [],
  };
}

function loadedProgram(program: Program, state: LoadState): Program {
  return {
    ...program,
    imports: state.imports,
    agents: state.agents,
  };
}

function readProgram(path: string, state: LoadState): Program {
  const cached = state.programs.get(path);
  if (cached) {
    return cached.program;
  }
  const source = readFileSync(path, "utf8");
  const program = parseSource(source, path);
  state.programs.set(path, { path, source, program });
  return program;
}

function parseSource(source: string, sourcePath: string | undefined): Program {
  const program = parse(source);
  if (sourcePath) {
    annotateSourcePath(program, sourcePath);
  }
  return program;
}

function annotateSourcePath(node: unknown, sourcePath: string, seen = new WeakSet<object>()): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (isAstNode(node)) {
    setNodeSourcePath(node, sourcePath);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) annotateSourcePath(item, sourcePath, seen);
    } else if (value && typeof value === "object") {
      annotateSourcePath(value, sourcePath, seen);
    }
  }
}

function isAstNode(value: object): value is NodeBase {
  return "kind" in value && "range" in value;
}

function mergeEntryProgram(program: Program, baseDir: string, state: LoadState): void {
  mergeImports(program.imports, baseDir, state);
  state.agents.push(...program.agents);
}

function mergeImports(imports: ImportDecl[], baseDir: string, state: LoadState): void {
  for (const imported of imports) {
    if (imported.resourceKind === "agent") {
      loadAgentImport(imported, baseDir, state);
    } else {
      addImport(normalizeImport(imported, baseDir), state);
    }
  }
}

function loadAgentImport(imported: ImportDecl, baseDir: string, state: LoadState): void {
  const path = resolveImportPath(imported.uri, baseDir);
  const importKey = `${path}#${imported.name}`;
  if (state.agentImportKeys.has(importKey)) {
    return;
  }
  if (state.loadingFiles.has(path)) {
    throw new Error(`Circular agent import detected at ${imported.uri}`);
  }

  state.agentImportKeys.add(importKey);
  state.loadingFiles.add(path);
  try {
    const program = readProgram(path, state);
    mergeImports(program.imports, dirname(path), state);
    const agent = program.agents.find((item) => item.name === imported.name);
    if (!agent) {
      throw new Error(`Imported agent '${imported.name}' was not found in ${imported.uri}`);
    }
    for (const item of program.agents) {
      const importedAgent = { ...item, isMain: false };
      setAgentSourcePath(importedAgent, path);
      addImportedAgent(importedAgent, path, state);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load agent import '${imported.name}' from ${path}: ${message}`);
  } finally {
    state.loadingFiles.delete(path);
  }
}

function addImport(imported: ImportDecl, state: LoadState): void {
  const key = `${imported.resourceKind}:${imported.name}:${imported.uri}`;
  if (state.importKeys.has(key)) {
    return;
  }
  state.importKeys.add(key);
  state.imports.push(imported);
}

function addImportedAgent(agent: AgentDecl, sourcePath: string, state: LoadState): void {
  const key = `${sourcePath}#${agent.name}`;
  if (state.importedAgentKeys.has(key)) {
    return;
  }
  state.importedAgentKeys.add(key);
  state.agents.push(agent);
}

function normalizeImport(imported: ImportDecl, baseDir: string): ImportDecl {
  if (imported.resourceKind === "file") {
    return {
      ...imported,
      uri: resolveImportPath(imported.uri, baseDir),
    };
  }
  if (imported.resourceKind === "memory") {
    return {
      ...imported,
      uri: normalizeMemoryImportUri(imported.uri, baseDir),
    };
  }
  return imported;
}

function normalizeMemoryImportUri(uri: string, baseDir: string): string {
  if (uri.startsWith(schemePrefix(FILE_SCHEME))) {
    return `${schemePrefix(FILE_SCHEME)}${resolveImportPath(uri, baseDir)}`;
  }
  if (uri.startsWith(schemePrefix(SQLITE_SCHEME))) {
    const { rawPath, rawNamespace } = splitSqliteUri(uri);
    const decodedPath = decodeURIComponent(rawPath);
    const path = isAbsolute(decodedPath) ? decodedPath : resolve(baseDir, decodedPath);
    const suffix = rawNamespace.length > 0 ? `#${rawNamespace}` : "";
    return `${schemePrefix(SQLITE_SCHEME)}${path}${suffix}`;
  }
  return uri;
}

function resolveImportPath(uri: string, baseDir: string): string {
  if (uri.startsWith(schemePrefix(FILE_SCHEME))) {
    const path = decodeURIComponent(uri.slice(schemePrefix(FILE_SCHEME).length));
    return isAbsolute(path) ? path : resolve(baseDir, path);
  }
  if (isAbsolute(uri)) {
    return uri;
  }
  return resolve(baseDir, uri);
}

function isRelativeImport(uri: string): boolean {
  return (
    !uri.startsWith(schemePrefix(FILE_SCHEME)) && !isAbsolute(uri) && (uri.startsWith("./") || uri.startsWith("../"))
  );
}

const FILE_RESOLUTION_KINDS = new Set(["agent", "file"]);

function requiresFileResolution(imported: ImportDecl): boolean {
  if (FILE_RESOLUTION_KINDS.has(imported.resourceKind)) {
    return true;
  }
  return imported.resourceKind === "memory" && memoryUriHasRelativePath(imported.uri);
}

function memoryUriHasRelativePath(uri: string): boolean {
  if (uri.startsWith(schemePrefix(FILE_SCHEME))) {
    return isRelativeImport(uri.slice(schemePrefix(FILE_SCHEME).length));
  }
  if (uri.startsWith(schemePrefix(SQLITE_SCHEME))) {
    return isRelativeImport(splitSqliteUri(uri).rawPath);
  }
  return false;
}
