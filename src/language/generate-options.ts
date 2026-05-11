import type {
  BooleanExpr,
  Budget,
  Expr,
  GenerateOptionsExpr,
  NumberExpr,
  ObjectProperty,
  StringExpr,
} from "../ast/types.js";

export type GenerateOptionKey = "input" | "attempts" | "max_output" | "temperature" | "think" | "strict" | "debug";

const DEFAULT_GENERATE_ATTEMPTS = 1;
const DEFAULT_GENERATE_STRICT = false;
const DEFAULT_GENERATE_DEBUG = false;

export interface GenerateOptionSpec {
  defaultValue?: unknown;
  invalidCode?: string;
  invalidMessage?: string;
  isValid?: (value: Expr, maxOutput?: Budget) => boolean;
}

export const GENERATE_OPTION_SPECS: Record<GenerateOptionKey, GenerateOptionSpec> = {
  input: {},
  attempts: {
    defaultValue: DEFAULT_GENERATE_ATTEMPTS,
    invalidCode: "INVALID_GENERATE_ATTEMPTS",
    invalidMessage: "generate attempts must be a positive integer",
    isValid: (value) => value.kind === "NumberExpr" && Number.isInteger(value.value) && value.value > 0,
  },
  max_output: {
    invalidCode: "INVALID_GENERATE_MAX_OUTPUT",
    invalidMessage: "generate max_output must be a positive budget",
    isValid: (_value, maxOutput) => maxOutput !== undefined && maxOutput.amount > 0,
  },
  temperature: {
    invalidCode: "INVALID_GENERATE_TEMPERATURE",
    invalidMessage: "generate temperature must be a number",
    isValid: (value) => value.kind === "NumberExpr",
  },
  think: {
    invalidCode: "INVALID_GENERATE_THINK",
    invalidMessage: "generate think must be a boolean or one of auto, low, medium, high",
    isValid: (value) => value.kind === "BooleanExpr" || isGenerateThinkExpression(value),
  },
  strict: {
    defaultValue: DEFAULT_GENERATE_STRICT,
    invalidCode: "INVALID_GENERATE_STRICT",
    invalidMessage: "generate strict must be a boolean",
    isValid: (value) => value.kind === "BooleanExpr",
  },
  debug: {
    defaultValue: DEFAULT_GENERATE_DEBUG,
    invalidCode: "INVALID_GENERATE_DEBUG",
    invalidMessage: "generate debug must be a boolean",
    isValid: (value) => value.kind === "BooleanExpr",
  },
};

export const GENERATE_OPTION_KEYS = new Set(Object.keys(GENERATE_OPTION_SPECS));

export const GENERATE_THINK_VALUES = new Set(["auto", "low", "medium", "high"]);

export function isGenerateOptionKey(value: string): boolean {
  return GENERATE_OPTION_KEYS.has(value);
}

export function isGenerateThinkValue(value: string): boolean {
  return GENERATE_THINK_VALUES.has(value);
}

export function getGenerateOptionSpec(key: string): GenerateOptionSpec | undefined {
  return GENERATE_OPTION_SPECS[key as GenerateOptionKey];
}

export function generateOptionDefault<T>(key: GenerateOptionKey): T | undefined {
  return GENERATE_OPTION_SPECS[key].defaultValue as T | undefined;
}

export function requiredGenerateOptionDefault<T>(key: GenerateOptionKey): T {
  const value = generateOptionDefault<T>(key);
  if (value === undefined) {
    throw new Error(`Missing default for generate option '${key}'`);
  }
  return value;
}

export function findGenerateProperty(options: GenerateOptionsExpr, key: GenerateOptionKey): ObjectProperty | undefined {
  return options.properties.find((property) => property.key === key);
}

export function readNumberGenerateProperty(
  options: GenerateOptionsExpr,
  key: GenerateOptionKey,
): NumberExpr | undefined {
  const property = findGenerateProperty(options, key);
  return property?.value.kind === "NumberExpr" ? property.value : undefined;
}

export function readBooleanGenerateProperty(
  options: GenerateOptionsExpr,
  key: GenerateOptionKey,
): BooleanExpr | undefined {
  const property = findGenerateProperty(options, key);
  return property?.value.kind === "BooleanExpr" ? property.value : undefined;
}

export function readThinkGenerateProperty(options: GenerateOptionsExpr): BooleanExpr | StringExpr | undefined {
  const property = findGenerateProperty(options, "think");
  if (!property) return undefined;
  if (property.value.kind === "BooleanExpr") return property.value;
  return isGenerateThinkExpression(property.value) ? property.value : undefined;
}

function isGenerateThinkExpression(value: Expr): value is StringExpr {
  return value.kind === "StringExpr" && isGenerateThinkValue(value.value);
}
