import { isAbsolute, relative, resolve } from "node:path";
import { RuntimeError } from "../../runtime/errors.js";
import { isObject } from "../../runtime/guards.js";
import { splitSqliteUri, uriScheme } from "../../language/uri.js";
import type { Disposable } from "../../runtime/disposable.js";
import type { MemoryAddRequest, MemoryProvider, MemoryQueryRequest, RuntimeValue } from "../../runtime/types.js";
import { FileMemoryBackend } from "./file.js";
import { SqliteMemoryBackend, type SqliteMemoryTarget } from "./sqlite.js";

export interface HostMemoryProviderOptions {
  baseDir?: string;
  workspaceRoot?: string;
}

export class HostMemoryProvider implements MemoryProvider, Disposable {
  private readonly file = new FileMemoryBackend();
  private readonly sqlite = new SqliteMemoryBackend();
  private readonly baseDir: string;
  private readonly workspaceRoot: string;

  constructor(options: HostMemoryProviderOptions = {}) {
    this.baseDir = resolve(options.baseDir ?? process.cwd());
    this.workspaceRoot = resolve(options.workspaceRoot ?? this.baseDir);
  }

  async add(request: MemoryAddRequest): Promise<RuntimeValue> {
    if (!isObject(request.record)) {
      throw new RuntimeError("memory.add expects an object record");
    }
    return this.backend(request.uri) === "file"
      ? this.file.add(request, this.resolveFileMemoryPath(request.uri))
      : this.sqlite.add(request, this.resolveSqliteMemory(request.uri));
  }

  async query(request: MemoryQueryRequest): Promise<RuntimeValue> {
    if (!isObject(request.query)) {
      throw new RuntimeError("memory.query expects an object query");
    }
    return this.backend(request.uri) === "file"
      ? this.file.query(request, this.resolveFileMemoryPath(request.uri))
      : this.sqlite.query(request, this.resolveSqliteMemory(request.uri));
  }

  async close(): Promise<void> {
    await this.sqlite.close();
  }

  private backend(uri: string): "file" | "sqlite" {
    if (uri.startsWith("file://")) return "file";
    if (uri.startsWith("sqlite://")) return "sqlite";
    throw new RuntimeError(`Unsupported memory URI scheme '${uriScheme(uri)}'`);
  }

  private resolveFileMemoryPath(uri: string): string {
    return this.resolveWorkspacePath(decodeURIComponent(uri.slice("file://".length)));
  }

  private resolveSqliteMemory(uri: string): SqliteMemoryTarget {
    const { rawPath, rawNamespace } = splitSqliteUri(uri);
    return {
      path: this.resolveWorkspacePath(decodeURIComponent(rawPath)),
      namespace: rawNamespace.length > 0 ? decodeURIComponent(rawNamespace) : "memory",
    };
  }

  private resolveWorkspacePath(rawPath: string): string {
    const path = isAbsolute(rawPath) ? rawPath : resolve(this.baseDir, rawPath);
    this.assertWithinWorkspace(path);
    return path;
  }

  private assertWithinWorkspace(path: string): void {
    const rel = relative(this.workspaceRoot, resolve(path));
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new RuntimeError(`Memory path '${path}' is outside workspace root '${this.workspaceRoot}'`);
    }
  }
}

export function createDefaultMemoryProvider(options: HostMemoryProviderOptions = {}): MemoryProvider {
  return new HostMemoryProvider(options);
}
