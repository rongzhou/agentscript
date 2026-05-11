import type { BuiltContext } from "./context.js";

export function writeGenerateDebugPrompt(agentName: string, attempt: number, builtContext: BuiltContext): void {
  const parts = [
    `--- AgentScript generate debug: ${agentName} attempt ${attempt} ---`,
    "System:",
    builtContext.system,
    "Final user message:",
    builtContext.finalUserMessage,
    "Return schema:",
    JSON.stringify(builtContext.returnSchema, null, 2),
    "--- end AgentScript generate debug ---",
  ];
  console.error(parts.join("\n"));
}
