import { builtinModules } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface NpmRegistry {
  allow: {
    node: Set<string>;
    npm: Map<string, NpmPackageEntry>;
  };
  path: string | null;
}

export interface NpmPackageEntry {
  name: string;
  version?: string;
  exports?: string[];
  effectful?: boolean;
}

export interface CheckedNpmImport {
  packageName: string;
  subPath?: string;
  entry: NpmPackageEntry;
}

const CONFIG_FILE = "agentscript.npm.json";
const NODE_BUILTINS = new Set(builtinModules.map((item) => item.replace(/^node:/, "")));

export function loadNpmRegistry(workspaceRoot: string): NpmRegistry {
  const path = join(workspaceRoot, CONFIG_FILE);
  if (!existsSync(path)) return emptyRegistry(null);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid npm registry '${CONFIG_FILE}': ${message}`);
  }
  return parseNpmRegistry(parsed, path);
}

export function checkNpmImport(uri: string, registry: NpmRegistry): CheckedNpmImport {
  const target = readNpmTarget(uri);
  const { packageName, subPath } = splitNpmTarget(target);
  const entry = registry.allow.npm.get(packageName);
  if (!entry) {
    throw new Error(`Package '${packageName}' is not allowed by ${CONFIG_FILE}`);
  }
  if (subPath && !entry.exports?.includes(subPath)) {
    throw new Error(`Package '${packageName}' sub-path '${subPath}' is not allowed by ${CONFIG_FILE}`);
  }
  return { packageName, subPath, entry };
}

export function checkNodeImport(uri: string, registry: NpmRegistry): string {
  const moduleName = readNodeTarget(uri);
  if (!registry.allow.node.has(moduleName)) {
    throw new Error(`Node module '${moduleName}' is not allowed by ${CONFIG_FILE}`);
  }
  return moduleName;
}

function readNpmTarget(uri: string): string {
  if (!uri.startsWith("npm:")) {
    throw new Error(`Expected npm: URI, got '${uri}'`);
  }
  const target = uri.slice("npm:".length);
  if (target.length === 0) {
    throw new Error("npm: URI must include a package name");
  }
  return target;
}

function readNodeTarget(uri: string): string {
  if (!uri.startsWith("node:")) {
    throw new Error(`Expected node: URI, got '${uri}'`);
  }
  const moduleName = uri.slice("node:".length);
  if (moduleName.length === 0) {
    throw new Error("node: URI must include a module name");
  }
  return moduleName;
}

function parseNpmRegistry(value: unknown, path: string): NpmRegistry {
  const root = expectPlainObject(value, `${CONFIG_FILE}`);
  const allowValue = root.allow;
  if (allowValue === undefined) return emptyRegistry(path);
  const allow = expectPlainObject(allowValue, `${CONFIG_FILE}.allow`);
  return {
    allow: {
      node: parseNodeAllow(allow.node, `${CONFIG_FILE}.allow.node`),
      npm: parseNpmAllow(allow.npm, `${CONFIG_FILE}.allow.npm`),
    },
    path,
  };
}

function parseNodeAllow(value: unknown, label: string): Set<string> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be a string array`);
  }
  for (const item of value) {
    if (item.startsWith("node:")) {
      throw new Error(`${label} entries must omit the node: prefix`);
    }
    if (!NODE_BUILTINS.has(item)) {
      throw new Error(`${label} contains unknown Node built-in module '${item}'`);
    }
  }
  return new Set(value);
}

function parseNpmAllow(value: unknown, label: string): Map<string, NpmPackageEntry> {
  const result = new Map<string, NpmPackageEntry>();
  if (value === undefined) return result;
  const entries = expectPlainObject(value, label);
  for (const [name, rawEntry] of Object.entries(entries)) {
    if (name.length === 0) {
      throw new Error(`${label} package name must not be empty`);
    }
    const entry = expectPlainObject(rawEntry, `${label}.${name}`);
    result.set(name, parsePackageEntry(name, entry, `${label}.${name}`));
  }
  return result;
}

function parsePackageEntry(name: string, value: Record<string, unknown>, label: string): NpmPackageEntry {
  const entry: NpmPackageEntry = { name };
  if (value.version !== undefined) {
    if (typeof value.version !== "string" || value.version.length === 0) {
      throw new Error(`${label}.version must be string`);
    }
    entry.version = value.version;
  }
  if (value.exports !== undefined) {
    if (!Array.isArray(value.exports) || value.exports.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error(`${label}.exports must be a string array`);
    }
    entry.exports = value.exports;
  }
  if (value.effectful !== undefined) {
    if (typeof value.effectful !== "boolean") {
      throw new Error(`${label}.effectful must be boolean`);
    }
    entry.effectful = value.effectful;
  }
  return entry;
}

function splitNpmTarget(target: string): { packageName: string; subPath?: string } {
  if (target.startsWith("@")) {
    const parts = target.split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid scoped npm package '${target}'`);
    }
    return { packageName: `${parts[0]}/${parts[1]}`, subPath: parts.slice(2).join("/") || undefined };
  }
  const [packageName, ...rest] = target.split("/");
  if (!packageName) {
    throw new Error(`Invalid npm package '${target}'`);
  }
  return { packageName, subPath: rest.join("/") || undefined };
}

function emptyRegistry(path: string | null): NpmRegistry {
  return { allow: { node: new Set(), npm: new Map() }, path };
}

function expectPlainObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}
