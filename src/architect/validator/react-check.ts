import type { AgentSpecDraft } from "../spec/schema.js";
import type { SpecDiagnostic } from "./diagnostics.js";
import { error } from "./diagnostics.js";
import { AGENT_SPEC_TYPES } from "../spec/types.js";
import {
  BUDGET_RE,
  RESERVED_REACT_NAMES,
  entriesOf,
  isPositiveInteger,
  isRecord,
  outputFields,
  patternOf,
  pointer,
} from "./helpers.js";
import { buildReferenceIndex, checkInputLocalRef, checkToolMethod } from "./reference-check.js";

export function checkReact(spec: AgentSpecDraft): SpecDiagnostic[] {
  if (patternOf(spec) !== "react" || !isRecord(spec.react)) return [];
  const diagnostics: SpecDiagnostic[] = [];
  const react = spec.react;
  const index = buildReferenceIndex(spec);
  const thoughtFields = outputFields(isRecord(react.reason) ? react.reason.output : undefined) ?? {};
  checkReserved(spec, diagnostics);
  if (!isPositiveInteger(react.max_iterations)) {
    diagnostics.push(
      error("INVALID_VALUE", "/react/max_iterations", "react.max_iterations must be a positive integer."),
    );
  }
  if (isRecord(react.scratch) && (typeof react.scratch.max !== "string" || !BUDGET_RE.test(react.scratch.max))) {
    diagnostics.push(error("INVALID_BUDGET_FORMAT", "/react/scratch/max", "react.scratch.max must match /^\\d+k?$/."));
  }
  for (const [fieldName, field] of entriesOf(thoughtFields)) {
    if (isRecord(field) && typeof field.type === "string" && !AGENT_SPEC_TYPES.has(field.type as never)) {
      diagnostics.push(
        error(
          "UNSUPPORTED_TYPE",
          pointer("react", "reason", "output", "fields", fieldName, "type"),
          `Unsupported AgentSpec type '${field.type}'.`,
        ),
      );
    }
  }
  if (isRecord(react.act)) {
    // ReAct actions use the same declared tool/method namespace as locals,
    // but diagnostics stay scoped to /react/act.
    checkToolMethod(react.act.tool, react.act.method, "/react/act", index, diagnostics);
    for (const [argName, argValue] of entriesOf(react.act.args)) {
      if (typeof argValue !== "string") continue;
      const path = pointer("react", "act", "args", argName);
      if (argValue.startsWith("thought.")) {
        const field = argValue.slice("thought.".length);
        if (!(field in thoughtFields))
          diagnostics.push(error("UNKNOWN_THOUGHT_REF", path, `Unknown thought reference '${argValue}'.`));
      } else if (argValue.startsWith("scratch.") || argValue.startsWith("done.") || argValue.startsWith("obs.")) {
        diagnostics.push(error("RESERVED_IDENTIFIER", path, `Reserved ReAct identifier used in '${argValue}'.`));
      } else {
        checkInputLocalRef(argValue, path, index, diagnostics);
      }
    }
  }
  checkStopWhen(react.stop_when, thoughtFields, diagnostics);
  return diagnostics;
}

function checkStopWhen(stopWhen: unknown, thoughtFields: Record<string, unknown>, diagnostics: SpecDiagnostic[]): void {
  if (typeof stopWhen !== "string") return;
  if (!/^thought\.[A-Za-z_][A-Za-z0-9_]*$/.test(stopWhen)) {
    diagnostics.push(
      error("INVALID_STOP_WHEN", "/react/stop_when", "stop_when must be the literal form thought.<field>."),
    );
    return;
  }
  const fieldName = stopWhen.slice("thought.".length);
  const field = thoughtFields[fieldName];
  if (!field) {
    diagnostics.push(error("UNKNOWN_THOUGHT_REF", "/react/stop_when", `Unknown thought reference '${stopWhen}'.`));
    return;
  }
  if (!isRecord(field) || field.type !== "boolean") {
    diagnostics.push(
      error("STOP_WHEN_NOT_BOOLEAN", "/react/stop_when", "stop_when must reference a boolean thought field."),
    );
  }
}

function checkReserved(spec: AgentSpecDraft, diagnostics: SpecDiagnostic[]): void {
  for (const name of Object.keys(isRecord(spec.inputs) ? spec.inputs : {})) {
    if (RESERVED_REACT_NAMES.has(name))
      diagnostics.push(
        error("RESERVED_IDENTIFIER", pointer("inputs", name), `'${name}' is reserved by ReAct lowering.`),
      );
  }
  for (const [index, local] of (Array.isArray(spec.locals) ? spec.locals : []).entries()) {
    if (isRecord(local) && typeof local.name === "string" && RESERVED_REACT_NAMES.has(local.name)) {
      diagnostics.push(
        error(
          "RESERVED_IDENTIFIER",
          pointer("locals", index, "name"),
          `'${local.name}' is reserved by ReAct lowering.`,
        ),
      );
    }
  }
  checkReservedContractFields(outputFields(spec.output) ?? {}, "/output/fields", diagnostics);
  if (isRecord(spec.react) && isRecord(spec.react.reason)) {
    checkReservedContractFields(
      outputFields(spec.react.reason.output) ?? {},
      "/react/reason/output/fields",
      diagnostics,
    );
  }
}

function checkReservedContractFields(
  fields: Record<string, unknown>,
  path: string,
  diagnostics: SpecDiagnostic[],
): void {
  for (const name of Object.keys(fields)) {
    if (name !== "done" && RESERVED_REACT_NAMES.has(name)) {
      diagnostics.push(error("RESERVED_IDENTIFIER", `${path}/${name}`, `'${name}' is reserved by ReAct lowering.`));
    }
  }
}
