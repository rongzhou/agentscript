import { dirname, resolve } from "node:path";

export interface RuntimePathOptions {
  sourcePath?: string;
  workspaceRoot?: string;
}

export interface RuntimePaths {
  sourceDir: string;
  workspaceRoot: string;
}

export function createRuntimePaths(options: RuntimePathOptions = {}): RuntimePaths {
  const sourceDir = options.sourcePath ? dirname(resolve(options.sourcePath)) : process.cwd();
  return {
    sourceDir,
    workspaceRoot: resolve(options.workspaceRoot ?? sourceDir),
  };
}
