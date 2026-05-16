import type { BooleanExpr, Expr, GenerateOptionsExpr, NumberExpr, ObjectProperty, StringExpr } from "../ast/types.js";

export type GenerateOptionKey = "input" | "attempts" | "max_output" | "temperature" | "think" | "strict" | "debug";
type NumberGenerateOptionKey = "attempts" | "temperature";
type BooleanGenerateOptionKey = "strict" | "debug";

export const DEFAULT_GENERATE_ATTEMPTS = 1;
export const DEFAULT_GENERATE_STRICT = false;
export const DEFAULT_GENERATE_DEBUG = false;

interface GenerateOptionSpec {
  invalidCode?: string;
  invalidMessage?: string;
  isValid?: (value: Expr) => boolean;
}

const GENERATE_OPTION_SPECS: Record<GenerateOptionKey, GenerateOptionSpec> = {
  input: {},
  attempts: {
    invalidCode: "INVALID_GENERATE_ATTEMPTS",
    invalidMessage: "generate attempts must be a positive integer",
    isValid: (value) => value.kind === "NumberExpr" && Number.isInteger(value.value) && value.value > 0,
  },
  max_output: {
    invalidCode: "INVALID_GENERATE_MAX_OUTPUT",
    invalidMessage: "generate max_output must be a positive budget",
  },
  temperature: {
    invalidCode: "INVALID_GENERATE_TEMPERATURE",
    invalidMessage: "generate temperature must be a number",
    isValid: (value) => value.kind === "NumberExpr",
  },
  think: {
    invalidCode: "INVALID_GENERATE_THINK",
    invalidMessage: "generate think must be a boolean or one of auto, low, medium, high",
    isValid: isGenerateThinkExpression,
  },
  strict: {
    invalidCode: "INVALID_GENERATE_STRICT",
    invalidMessage: "generate strict must be a boolean",
    isValid: (value) => value.kind === "BooleanExpr",
  },
  debug: {
    invalidCode: "INVALID_GENERATE_DEBUG",
    invalidMessage: "generate debug must be a boolean",
    isValid: (value) => value.kind === "BooleanExpr",
  },
};

const GENERATE_OPTION_KEYS = new Set(Object.keys(GENERATE_OPTION_SPECS));

const GENERATE_THINK_VALUES = new Set(["auto", "low", "medium", "high"]);

export function isGenerateOptionKey(value: string): boolean {
  return GENERATE_OPTION_KEYS.has(value);
}

function isGenerateThinkValue(value: string): boolean {
  return GENERATE_THINK_VALUES.has(value);
}

export function invalidGenerateOptionValue(key: string, value: Expr): { code: string; message: string } | undefined {
  const spec = GENERATE_OPTION_SPECS[key as GenerateOptionKey];
  if (!spec?.isValid || spec.isValid(value)) {
    return undefined;
  }
  return {
    code: spec.invalidCode ?? "INVALID_GENERATE_OPTION",
    message: spec.invalidMessage ?? "Invalid generate option",
  };
}

function findGenerateProperty(options: GenerateOptionsExpr, key: GenerateOptionKey): ObjectProperty | undefined {
  return options.properties.find((property) => property.key === key);
}

export function findGenerateInputProperty(options: GenerateOptionsExpr): ObjectProperty | undefined {
  return findGenerateProperty(options, "input");
}

export function readGenerateNumberProperty(
  options: GenerateOptionsExpr,
  key: NumberGenerateOptionKey,
): NumberExpr | undefined {
  return readGenerateProperty(options, key, isNumberExpression);
}

export function readGenerateBooleanProperty(
  options: GenerateOptionsExpr,
  key: BooleanGenerateOptionKey,
): BooleanExpr | undefined {
  return readGenerateProperty(options, key, isBooleanExpression);
}

export function readGenerateThinkProperty(options: GenerateOptionsExpr): BooleanExpr | StringExpr | undefined {
  return readGenerateProperty(options, "think", isGenerateThinkExpression);
}

function readGenerateProperty<T extends Expr>(
  options: GenerateOptionsExpr,
  key: GenerateOptionKey,
  predicate: (value: Expr) => value is T,
): T | undefined {
  const property = findGenerateProperty(options, key);
  return property && predicate(property.value) ? property.value : undefined;
}

function isNumberExpression(value: Expr): value is NumberExpr {
  return value.kind === "NumberExpr";
}

function isBooleanExpression(value: Expr): value is BooleanExpr {
  return value.kind === "BooleanExpr";
}

function isGenerateThinkExpression(value: Expr): value is BooleanExpr | StringExpr {
  return isBooleanExpression(value) || (value.kind === "StringExpr" && isGenerateThinkValue(value.value));
}
