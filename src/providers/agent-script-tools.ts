import { ARCHITECT_SCHEME, OPTIMIZER_SCHEME } from "../language/schemes.js";
import { ArchitectToolProvider } from "../architect/tool/provider.js";
import { OptimizerToolProvider, type OptimizerToolContext } from "../optimizer/provider.js";
import { createDefaultToolProvider } from "./tools/host.js";
import type { ToolProvider } from "../runtime/values/providers.js";

export type HostNamespaceProviders = Record<string, ToolProvider>;

export function createAgentScriptHostNamespaces(context: OptimizerToolContext): HostNamespaceProviders {
  return {
    [OPTIMIZER_SCHEME]: new OptimizerToolProvider(context),
    [ARCHITECT_SCHEME]: new ArchitectToolProvider(),
  };
}

export function createAgentScriptToolProvider(
  workspaceRoot = process.cwd(),
  optimizer?: Partial<OptimizerToolContext>,
): ToolProvider {
  return createDefaultToolProvider(
    workspaceRoot,
    createAgentScriptHostNamespaces({
      workspaceRoot,
      ...optimizer,
    }),
  );
}
