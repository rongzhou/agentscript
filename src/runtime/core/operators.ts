import type { BinaryExpr, SourceRange } from "../../ast/types.js";
import { RuntimeError } from "./errors.js";
import { runtimeValuesEqual } from "../values/json.js";
import { isTruthy } from "./truth.js";
import type { RuntimeValue } from "../values/values.js";

export type BinaryOperator = BinaryExpr["operator"];

export function evaluateBinaryOperator(
  operator: BinaryOperator,
  left: RuntimeValue,
  right: RuntimeValue,
  range: SourceRange,
): RuntimeValue {
  switch (operator) {
    case "and":
      return isTruthy(left) && isTruthy(right);
    case "or":
      return isTruthy(left) || isTruthy(right);
    case "==":
      return runtimeValuesEqual(left, right);
    case "!=":
      return !runtimeValuesEqual(left, right);
    case "<":
    case "<=":
    case ">":
    case ">=":
      return evaluateComparison(operator, left, right, range);
    case "+":
    case "-":
    case "*":
    case "/":
      return evaluateArithmetic(operator, left, right, range);
  }
}

function evaluateComparison(
  operator: Extract<BinaryOperator, "<" | "<=" | ">" | ">=">,
  left: RuntimeValue,
  right: RuntimeValue,
  range: SourceRange,
): boolean {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new RuntimeError(`operator '${operator}' requires number operands`, range);
  }
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
  }
}

function evaluateArithmetic(
  operator: Extract<BinaryOperator, "+" | "-" | "*" | "/">,
  left: RuntimeValue,
  right: RuntimeValue,
  range: SourceRange,
): RuntimeValue {
  if (operator === "+" && (typeof left === "string" || typeof right === "string")) {
    return `${formatArithmeticOperand(left)}${formatArithmeticOperand(right)}`;
  }
  if (typeof left !== "number" || typeof right !== "number") {
    throw new RuntimeError(`operator '${operator}' requires number operands`, range);
  }
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0) {
        throw new RuntimeError("operator '/' cannot divide by zero", range);
      }
      return left / right;
  }
}

function formatArithmeticOperand(value: RuntimeValue): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}
