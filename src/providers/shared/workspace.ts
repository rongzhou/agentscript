import { existsSync, lstatSync, readdirSync, realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { RuntimeError } from "../../runtime/errors.js";

export interface WorkspaceContext {
  workspaceRoot: string;
  resolveWorkspacePath(path: string, baseDir?: string): string;
  workspaceRelativePath(path: string): string;
  visitWorkspaceTree(root: string, visitor: WorkspaceTreeVisitor): void;
}

export type WorkspaceTreeVisitor = (path: string, relativePath: string, stat: Stats) => boolean;

export class Workspace implements WorkspaceContext {
  readonly workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = realpathSync(resolve(workspaceRoot));
  }

  resolveWorkspacePath(path: string, baseDir = this.workspaceRoot): string {
    const resolved = isAbsolute(path) ? resolve(path) : resolve(baseDir, path);
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
