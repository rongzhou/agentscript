import { dirname, resolve } from "node:path";

interface RuntimePathOptions {
  sourcePath?: string;
  workspaceRoot?: string;
}

interface RuntimePaths {
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
