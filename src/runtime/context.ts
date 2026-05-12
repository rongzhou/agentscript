import type { Budget, ContractObjectExpr } from "../ast/types.js";
import { clipJson } from "./context-clip.js";
import { renderJson } from "./context-render.js";
import { contractToSchema } from "./contract-schema.js";
import { budgetToJson, sanitizeForJson } from "./json.js";
import type { ContextUse, JsonObject, JsonValue, LlmBinding, RuntimeValue } from "./types.js";

export interface ContextBuildInput {
  agentName: string;
  model?: LlmBinding;
  identity: JsonObject;
  instruction: RuntimeValue;
  returnContract?: ContractObjectExpr;
  uses: ContextUse[];
  maxOutput?: Budget;
}

export interface BuiltContextItem {
  index: number;
  source?: string;
  label?: string;
  value: JsonValue;
  text: string;
  budget?: Budget;
  clipped: boolean;
  originalSize: number;
  clippedSize: number;
}

export interface BuiltContext {
  agentName: string;
  model?: LlmBinding;
  identity: JsonObject;
  system: string;
  context: BuiltContextItem[];
  returnSchema?: JsonObject;
  maxOutput?: Budget;
  finalUserMessage: string;
}

export function buildContext(input: ContextBuildInput): BuiltContext {
  const context = input.uses.map((item, index) => buildContextItem(item, index));
  const instruction = sanitizeForJson(input.instruction);
  const instructionText = renderJson(instruction);
  const system = buildSystemPrompt(input.agentName, input.identity);
  const returnSchema = input.returnContract ? contractToSchema(input.returnContract) : undefined;

  return {
    agentName: input.agentName,
    model: input.model,
    identity: input.identity,
    system,
    context,
    returnSchema,
    maxOutput: input.maxOutput,
    finalUserMessage: buildFinalUserMessage(context, instructionText, returnSchema),
  };
}

function buildContextItem(item: ContextUse, index: number): BuiltContextItem {
  const value = sanitizeForJson(item.value);
  const clipped = clipJson(value, item.budget);

  return {
    index,
    source: item.source,
    label: item.label,
    value: clipped.value,
    text: clipped.text,
    budget: item.budget,
    clipped: clipped.clipped,
    originalSize: clipped.originalSize,
    clippedSize: clipped.clippedSize,
  };
}

function buildSystemPrompt(agentName: string, identity: JsonObject): string {
  const role = typeof identity.role === "string" ? identity.role : agentName;
  const lines = [`You are ${role}.`];
  if (typeof identity.description === "string") {
    lines.push(identity.description);
  }
  for (const [key, value] of Object.entries(identity)) {
    if (key === "role" || key === "description") {
      continue;
    }
    lines.push(`${key}: ${renderJson(value)}`);
  }
  return lines.join("\n");
}

function buildFinalUserMessage(
  context: BuiltContextItem[],
  instructionText: string,
  returnSchema?: JsonObject,
): string {
  const sections: string[] = [];

  if (context.length > 0) {
    sections.push("Context:");
    for (const item of context) {
      const label = item.label ?? String(item.index);
      const source = item.source ? `source: ${item.source}\n` : "";
      sections.push(`[${label}]\n${source}${item.text}`);
    }
  }

  sections.push("Instruction:", instructionText);
  if (returnSchema) {
    sections.push("Return JSON matching this schema:", renderJson(returnSchema));
  }

  return sections.join("\n");
}

export function builtContextToJson(context: BuiltContext): JsonObject {
  return {
    agent_name: context.agentName,
    model: context.model ? { name: context.model.name, uri: context.model.uri } : null,
    identity: context.identity,
    system: context.system,
    context: context.context.map((item) => ({
      index: item.index,
      source: item.source ?? null,
      label: item.label ?? null,
      value: item.value,
      text: item.text,
      budget: budgetToJson(item.budget),
      clipped: item.clipped,
      original_size: item.originalSize,
      clipped_size: item.clippedSize,
    })),
    return_schema: context.returnSchema ?? null,
    max_output: budgetToJson(context.maxOutput),
    final_user_message: context.finalUserMessage,
  };
}
