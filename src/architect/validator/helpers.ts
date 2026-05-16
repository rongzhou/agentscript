import type { AgentSpecDraft } from "../spec/types.js";
import type { SourceRange } from "../../ast/types.js";
import type { DiagnosticBase } from "../../language/diagnostic.js";

export interface SpecDiagnostic extends DiagnosticBase {
  path: string;
  range?: SourceRange;
  suggested_fix?: string;
}

export interface ValidateResult {
  ok: boolean;
  diagnostics: SpecDiagnostic[];
}

export const AGENT_NAME_RE = /^[A-Z][A-Za-z0-9_]*$/;
export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const BUDGET_RE = /^\d+k?$/;
export const RESERVED_REACT_NAMES = new Set(["thought", "obs", "scratch", "done"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function entriesOf(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function patternOf(spec: AgentSpecDraft): string {
  return typeof spec.pattern === "string" ? spec.pattern : "linear";
}

export function pointer(...parts: Array<string | number>): string {
  return `/${parts.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

export function outputFields(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output) || !isRecord(output.fields)) return null;
  return output.fields;
}

export function error(code: string, path: string, message: string, suggested_fix?: string): SpecDiagnostic {
  return suggested_fix
    ? { severity: "error", code, path, message, suggested_fix }
    : { severity: "error", code, path, message };
}

export function okFromDiagnostics(diagnostics: SpecDiagnostic[]): boolean {
  return !diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
