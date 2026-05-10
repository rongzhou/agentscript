import { existsSync, lstatSync, realpathSync, readdirSync, statSync, type Stats } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { RuntimeError } from "../../runtime/errors.js";
import { isObject } from "../../runtime/guards.js";
import { sanitizeForJson } from "../../runtime/json.js";
import type { RuntimeValue } from "../../runtime/types.js";

import { type Disposable, isDisposable } from "../../runtime/disposable.js";
import type { ToolProvider } from "../../runtime/types.js";

export const DEFAULT_MAX_RESULTS = 100;

export interface WorkspaceContext {
  workspaceRoot: string;
  resolveWorkspacePath(path: string): string;
  workspaceRelativePath(path: string): string;
  visitWorkspaceTree(root: string, visitor: WorkspaceTreeVisitor): void;
}

export type WorkspaceTreeVisitor = (path: string, relativePath: string, stat: Stats) => boolean;

export class Workspace implements WorkspaceContext {
  readonly workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = realpathSync(resolve(workspaceRoot));
  }

  resolveWorkspacePath(path: string): string {
    const resolved = resolve(this.workspaceRoot, path);
    if (resolved !== this.workspaceRoot && !resolved.startsWith(`${this.workspaceRoot}${sep}`)) {
      throw new RuntimeError(`Path escapes workspace: ${path}`);
    }
    if (existsSync(resolved)) {
      const real = realpathSync(resolved);
      if (real !== this.workspaceRoot && !real.startsWith(`${this.workspaceRoot}${sep}`)) {
        throw new RuntimeError(`Path escapes workspace: ${path}`);
      }
    }
    return resolved;
  }

  workspaceRelativePath(path: string): string {
    return relative(this.workspaceRoot, path);
  }

  visitWorkspaceTree(root: string, visitor: WorkspaceTreeVisitor): void {
    const visit = (path: string): boolean => {
      const linkStat = lstatSync(path);
      if (linkStat.isSymbolicLink()) return true;
      const stat = statSync(path);
      const relativePath = relative(this.workspaceRoot, path) || ".";
      if (visitor(path, relativePath, stat) === false) return false;
      if (stat.isDirectory()) {
        for (const entry of readdirSync(path)) {
          if (visit(resolve(path, entry)) === false) return false;
        }
      }
      return true;
    };
    if (existsSync(root)) visit(root);
  }
}

export function expectObject(value: RuntimeValue | undefined, call: string): Record<string, RuntimeValue> {
  if (!isObject(value ?? null)) {
    throw new RuntimeError(`${call} expects one json object argument`);
  }
  return value as Record<string, RuntimeValue>;
}

export function expectPlainObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function readRequiredString(value: RuntimeValue | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RuntimeError(`${name} is required`);
  }
  return value;
}

export function readOptionalString(value: RuntimeValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RuntimeError(`Expected a string, got ${JSON.stringify(sanitizeForJson(value))}`);
  }
  return value;
}

export function readPositiveInteger(value: RuntimeValue | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new RuntimeError(`Expected a positive integer, got ${JSON.stringify(sanitizeForJson(value))}`);
}

export function globMatcher(pattern: string): (value: string) => boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`(^|/)${escaped}$`);
  return (value) => regex.test(value);
}

export function toolUriTarget(uri: string): string {
  const parsed = new URL(uri);
  return parsed.hostname || parsed.pathname.replace(/^\//, "");
}

export function parseJsonOrNull(text: string): RuntimeValue {
  try {
    return JSON.parse(text) as RuntimeValue;
  } catch {
    return null;
  }
}

export async function closeDisposableProviders(providers: Record<string, ToolProvider>): Promise<void> {
  const unique = new Set(Object.values(providers));
  const disposables: Disposable[] = [...unique].filter(isDisposable);
  await Promise.all(disposables.map((provider) => provider.close()));
}
