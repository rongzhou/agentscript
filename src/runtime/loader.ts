import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AgentDecl, ImportDecl, Program } from "../ast/types.js";
import { parse } from "../parser/parser.js";

export interface LoadProgramOptions {
  sourcePath?: string;
}

interface LoadState {
  agentImportKeys: Set<string>;
  imports: ImportDecl[];
  importKeys: Set<string>;
  loadingFiles: Set<string>;
  programs: Map<string, Program>;
  agents: AgentDecl[];
}

export function loadProgram(path: string): Program {
  const entryPath = resolve(path);
  const state = createLoadState();
  const program = readProgram(entryPath, state);
  mergeEntryProgram(program, dirname(entryPath), state);
  return loadedProgram(program, state);
}

export function loadProgramSource(source: string, options: LoadProgramOptions = {}): Program {
  const sourcePath = options.sourcePath ? resolve(options.sourcePath) : undefined;
  const state = createLoadState();
  const program = parse(source);
  const baseDir = sourceBaseDir(program, sourcePath);
  mergeEntryProgram(program, baseDir, state);
  return loadedProgram(program, state);
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
    return cached;
  }
  const program = parse(readFileSync(path, "utf8"));
  state.programs.set(path, program);
  return program;
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
    state.agents.push({
      ...agent,
      isMain: false,
    });
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
  if (uri.startsWith("file://")) {
    return `file://${resolveImportPath(uri, baseDir)}`;
  }
  if (uri.startsWith("sqlite://")) {
    const raw = uri.slice("sqlite://".length);
    const hashIndex = raw.indexOf("#");
    const rawPath = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const rawNamespace = hashIndex >= 0 ? raw.slice(hashIndex) : "";
    const decodedPath = decodeURIComponent(rawPath);
    const path = isAbsolute(decodedPath) ? decodedPath : resolve(baseDir, decodedPath);
    return `sqlite://${path}${rawNamespace}`;
  }
  return uri;
}

function resolveImportPath(uri: string, baseDir: string): string {
  if (uri.startsWith("file://")) {
    const path = decodeURIComponent(uri.slice("file://".length));
    return isAbsolute(path) ? path : resolve(baseDir, path);
  }
  if (isAbsolute(uri)) {
    return uri;
  }
  return resolve(baseDir, uri);
}

function isRelativeImport(uri: string): boolean {
  return !uri.startsWith("file://") && !isAbsolute(uri) && (uri.startsWith("./") || uri.startsWith("../"));
}

const FILE_RESOLUTION_KINDS = new Set(["agent", "file"]);

function requiresFileResolution(imported: ImportDecl): boolean {
  if (FILE_RESOLUTION_KINDS.has(imported.resourceKind)) {
    return true;
  }
  return imported.resourceKind === "memory" && memoryUriHasRelativePath(imported.uri);
}

function memoryUriHasRelativePath(uri: string): boolean {
  if (uri.startsWith("file://")) {
    return isRelativeImport(uri.slice("file://".length));
  }
  if (uri.startsWith("sqlite://")) {
    const raw = uri.slice("sqlite://".length);
    const hashIndex = raw.indexOf("#");
    return isRelativeImport(hashIndex >= 0 ? raw.slice(0, hashIndex) : raw);
  }
  return false;
}
