import type { Budget, ShapeObjectExpr, ShapeTypeExpr } from "../ast/types.js";
import { budgetToJson, sanitizeForJson } from "./json.js";
import type { ContextUse, JsonObject, JsonValue, LlmBinding, RuntimeValue } from "./types.js";

export interface ContextBuildInput {
  agentName: string;
  model?: LlmBinding;
  identity: JsonObject;
  instruction: RuntimeValue;
  returnShape?: ShapeObjectExpr;
  uses: ContextUse[];
  budget?: Budget;
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
  instruction: JsonValue;
  instructionText: string;
  returnSchema?: JsonObject;
  budget?: Budget;
  finalUserMessage: string;
}

export function buildContext(input: ContextBuildInput): BuiltContext {
  const context = input.uses.map((item, index) => buildContextItem(item, index));
  const instruction = sanitizeForJson(input.instruction);
  const instructionText = renderJson(instruction);
  const system = buildSystemPrompt(input.agentName, input.identity);
  const returnSchema = input.returnShape ? shapeToSchema(input.returnShape) : undefined;

  return {
    agentName: input.agentName,
    model: input.model,
    identity: input.identity,
    system,
    context,
    instruction,
    instructionText,
    returnSchema,
    budget: input.budget,
    finalUserMessage: buildFinalUserMessage(context, instructionText, returnSchema),
  };
}

export function shapeToSchema(shape: ShapeObjectExpr): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];

  for (const field of shape.fields) {
    properties[field.name] = shapeTypeToSchema(field.type);
    required.push(field.name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const SHAPE_TYPE_TO_JSON_SCHEMA: Record<string, JsonObject> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  json: {},
  list: { type: "array" },
};

function shapeTypeToSchema(type: ShapeTypeExpr): JsonObject {
  if (type.kind === "ListShapeType") {
    return { type: "array", items: shapeTypeToSchema(type.itemType) };
  }
  return SHAPE_TYPE_TO_JSON_SCHEMA[type.name] ?? {};
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

function renderJson(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function clipJson(
  value: JsonValue,
  budget?: Budget,
): { value: JsonValue; text: string; clipped: boolean; originalSize: number; clippedSize: number } {
  const maxChars = budgetToCharLimit(budget);
  const text = renderJson(value);
  if (!maxChars || text.length <= maxChars) {
    return { value, text, clipped: false, originalSize: text.length, clippedSize: text.length };
  }
  const clippedValue = clipValueToBudget(value, maxChars);
  const clippedText = renderJson(clippedValue);
  return {
    value: clippedValue,
    text: clippedText,
    clipped: clippedText !== text,
    originalSize: text.length,
    clippedSize: clippedText.length,
  };
}

function clipValueToBudget(value: JsonValue, maxChars: number): JsonValue {
  if (typeof value === "string") return value.slice(0, maxChars);
  if (Array.isArray(value)) return clipArrayToBudget(value, maxChars);
  if (value && typeof value === "object") return clipObjectToBudget(value as JsonObject, maxChars);
  return value;
}

function clipArrayToBudget(value: JsonValue[], maxChars: number): JsonValue[] {
  const end = findLargestPrefix(value.length, (count) => renderJson(value.slice(0, count)).length <= maxChars);
  return value.slice(0, end);
}

function clipObjectToBudget(value: JsonObject, maxChars: number): JsonObject {
  const entries = Object.entries(value);
  const end = findLargestPrefix(
    entries.length,
    (count) => renderJson(Object.fromEntries(entries.slice(0, count))).length <= maxChars,
  );
  return Object.fromEntries(entries.slice(0, end));
}

function findLargestPrefix(length: number, fits: (count: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

function budgetToCharLimit(budget?: Budget): number | undefined {
  if (!budget) return undefined;
  const amount = budget.unit === "k" ? budget.amount * 1000 : budget.amount;
  return Math.floor(amount);
}

export function builtContextToJson(context: BuiltContext): JsonObject {
  return {
    agentName: context.agentName,
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
      originalSize: item.originalSize,
      clippedSize: item.clippedSize,
    })),
    instruction: context.instruction,
    returnSchema: context.returnSchema ?? null,
    budget: budgetToJson(context.budget),
    finalUserMessage: context.finalUserMessage,
  };
}
