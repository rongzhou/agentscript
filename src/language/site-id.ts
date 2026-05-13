import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface SiteIdContext {
  sourcePath?: string;
  workspaceRoot?: string;
  agentName: string;
  funcName?: string;
  label: string;
  ordinal: number;
}

export function buildSiteId(ctx: SiteIdContext): string {
  const path = normalizeTargetPath(ctx.sourcePath, ctx.workspaceRoot);
  const scope = ctx.funcName ? `${ctx.agentName}.${ctx.funcName}` : ctx.agentName;
  const label = ctx.ordinal <= 1 ? ctx.label : `${ctx.label}#${ctx.ordinal}`;
  return `${path}#${scope}[${label}]`;
}

export function normalizeTargetPath(sourcePath: string | undefined, workspaceRoot: string | undefined): string {
  if (!sourcePath) return "<memory>";
  const absolutePath = resolve(sourcePath);
  const base = workspaceRoot ? resolve(workspaceRoot) : process.cwd();
  const relativePath = relative(base, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !isAbsoluteLike(relativePath)) {
    return toPosixPath(relativePath);
  }
  return toPosixPath(pathToFileURL(absolutePath).pathname);
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isAbsoluteLike(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:/.test(path);
}
