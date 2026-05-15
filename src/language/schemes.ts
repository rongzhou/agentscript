export const FILE_SCHEME = "file";
export const SQLITE_SCHEME = "sqlite";
export const NPM_SCHEME = "npm";
export const NODE_SCHEME = "node";
export const MCP_SCHEME = "mcp";
export const ENV_SCHEME = "env";
export const HTTP_SCHEME = "http";
export const HTTPS_SCHEME = "https";
export const SHELL_SCHEME = "sh";
export const OPTIMIZER_SCHEME = "optimizer";

export function schemePrefix(scheme: string): `${string}://` {
  return `${scheme}://`;
}
