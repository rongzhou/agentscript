import type { LlmProvider, MemoryProvider, ToolProvider } from "../runtime/types.js";

export interface OptimizerToolContext {
  workspaceRoot: string;
  artifactsDir?: string;
  budget?: {
    incrementTrial(): void;
    incrementLlm(): void;
    checkDeadline(): void;
  };
  llmProvider?: LlmProvider;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
}
