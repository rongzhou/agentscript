import { resolve } from "node:path";
import { FILE_SCHEME, SQLITE_SCHEME, schemePrefix } from "../../language/schemes.js";
import { splitSqliteUri, uriScheme } from "../../language/uri.js";
import { RuntimeError } from "../../runtime/errors.js";
import { isObject } from "../../runtime/guards.js";
import type { Disposable } from "../../runtime/providers.js";
import type { MemoryAddRequest, MemoryProvider, MemoryQueryRequest, RuntimeValue } from "../../runtime/types.js";
import { Workspace } from "../shared/workspace.js";
import { FileMemoryBackend } from "./file.js";
import { SqliteMemoryBackend, type SqliteMemoryTarget } from "./sqlite.js";

type MemoryBackendKind = typeof FILE_SCHEME | typeof SQLITE_SCHEME;

export interface HostMemoryProviderOptions {
  baseDir?: string;
  workspaceRoot?: string;
}

export class HostMemoryProvider implements MemoryProvider, Disposable {
  private readonly file = new FileMemoryBackend();
  private readonly sqlite = new SqliteMemoryBackend();
  private readonly baseDir: string;
  private readonly workspace: Workspace;

  constructor(options: HostMemoryProviderOptions = {}) {
    this.baseDir = resolve(options.baseDir ?? process.cwd());
    this.workspace = new Workspace(options.workspaceRoot ?? this.baseDir);
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

  private backend(uri: string): MemoryBackendKind {
    if (uri.startsWith(schemePrefix(FILE_SCHEME))) return FILE_SCHEME;
    if (uri.startsWith(schemePrefix(SQLITE_SCHEME))) return SQLITE_SCHEME;
    throw new RuntimeError(`Unsupported memory URI scheme '${uriScheme(uri)}'`);
  }

  private resolveFileMemoryPath(uri: string): string {
    return this.workspace.resolveWorkspacePath(
      decodeURIComponent(uri.slice(schemePrefix(FILE_SCHEME).length)),
      this.baseDir,
    );
  }

  private resolveSqliteMemory(uri: string): SqliteMemoryTarget {
    const { rawPath, rawNamespace } = splitSqliteUri(uri);
    return {
      path: this.workspace.resolveWorkspacePath(decodeURIComponent(rawPath), this.baseDir),
      namespace: rawNamespace.length > 0 ? decodeURIComponent(rawNamespace) : "memory",
    };
  }
}

export function createDefaultMemoryProvider(options: HostMemoryProviderOptions = {}): MemoryProvider {
  return new HostMemoryProvider(options);
}
