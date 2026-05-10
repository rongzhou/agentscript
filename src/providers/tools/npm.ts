import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RuntimeError } from "../../runtime/errors.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { invokeModuleMember } from "./module-tool.js";
import { checkNpmImport, type NpmPackageEntry, type NpmRegistry } from "./npm-registry.js";

export class NpmToolProvider implements ToolProvider {
  private readonly modules = new Map<string, unknown>();
  private readonly verifiedPackages = new Set<string>();
  private readonly requireFromWorkspace: NodeRequire;

  constructor(
    private readonly registry: NpmRegistry,
    private readonly workspaceRoot: string,
  ) {
    this.requireFromWorkspace = createRequire(join(resolve(workspaceRoot), "package.json"));
  }

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const checked = checkNpmImport(request.uri, this.registry);
    this.verifyInstalledVersion(checked.packageName, checked.entry);
    const mod = await this.loadModule(checked.packageName, checked.subPath);
    return invokeModuleMember(mod, request, { schemeLabel: "npm", toolLabel: request.toolName });
  }

  private async loadModule(packageName: string, subPath?: string): Promise<unknown> {
    const target = subPath ? `${packageName}/${subPath}` : packageName;
    const cached = this.modules.get(target);
    if (cached) return cached;
    try {
      const resolved = this.requireFromWorkspace.resolve(target);
      const mod = await import(pathToFileURL(resolved).href);
      this.modules.set(target, mod);
      return mod;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(
        `Failed to load npm package '${target}': ${message}. Possible causes: package is not installed or workspace root is incorrect.`,
      );
    }
  }

  private verifyInstalledVersion(packageName: string, entry: NpmPackageEntry): void {
    if (!entry.version || this.verifiedPackages.has(packageName)) return;
    const packageJsonPath = join(this.workspaceRoot, "node_modules", packageName, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new RuntimeError(`Package '${packageName}' package.json was not found under node_modules`);
    }
    const version = readPackageVersion(packageJsonPath, packageName);
    if (!satisfiesVersion(version, entry.version)) {
      throw new RuntimeError(
        `Package '${packageName}' installed version '${version}' does not satisfy '${entry.version}' in agentscript.npm.json`,
      );
    }
    this.verifiedPackages.add(packageName);
  }
}

function readPackageVersion(path: string, packageName: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeError(`Package '${packageName}' package.json is invalid: ${message}`);
  }
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || typeof parsed.version !== "string") {
    throw new RuntimeError(`Package '${packageName}' package.json version must be a string`);
  }
  return parsed.version;
}

function satisfiesVersion(version: string, range: string): boolean {
  if (range === "*") return true;
  const current = parseVersion(version);
  if (range.startsWith(">=")) {
    return compareVersions(current, parseVersion(range.slice(2))) >= 0;
  }
  if (range.startsWith("^")) {
    const base = parseVersion(range.slice(1));
    return compareVersions(current, base) >= 0 && current.major === base.major;
  }
  if (range.startsWith("~")) {
    const base = parseVersion(range.slice(1));
    return compareVersions(current, base) >= 0 && current.major === base.major && current.minor === base.minor;
  }
  if (/^\d+\.\d+\.\d+$/.test(range)) {
    return compareVersions(current, parseVersion(range)) === 0;
  }
  throw new RuntimeError(`Unsupported version range '${range}' in agentscript.npm.json`);
}

function parseVersion(value: string): { major: number; minor: number; patch: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) {
    throw new RuntimeError(`Invalid semver version '${value}'`);
  }
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
  };
}

function compareVersions(
  left: { major: number; minor: number; patch: number },
  right: { major: number; minor: number; patch: number },
): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
