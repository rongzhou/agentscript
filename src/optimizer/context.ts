import type { LlmProvider, MemoryProvider, ToolProvider } from "../runtime/values/providers.js";

export interface BudgetCounter {
  incrementTrial(): void;
  incrementLlm(): void;
  checkDeadline(): void;
}

export interface OptimizerToolContext {
  workspaceRoot: string;
  artifactsDir?: string;
  budget?: BudgetCounter;
  llmProvider?: LlmProvider;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
}
