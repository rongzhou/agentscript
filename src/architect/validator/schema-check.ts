import { AGENT_SPEC_TYPES } from "../spec/types.js";
import type { AgentSpecDraft } from "../spec/schema.js";
import {
  AGENT_NAME_RE,
  BUDGET_RE,
  IDENTIFIER_RE,
  error,
  arrayOf,
  entriesOf,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  outputFields,
  patternOf,
  pointer,
  type SpecDiagnostic,
} from "./helpers.js";

const REQUIRED_TOP_LEVEL = [
  "version",
  "agent",
  "model",
  "inputs",
  "tools",
  "locals",
  "model_context",
  "generation",
  "output",
];

export function checkSchema(spec: AgentSpecDraft): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in spec))
      diagnostics.push(error("MISSING_FIELD", pointer(field), `Missing required field '${field}'.`));
  }
  if (typeof spec.version === "string" && spec.version !== "0.1") {
    diagnostics.push(error("INVALID_VERSION", "/version", "AgentSpec version must be '0.1'."));
  }
  if ("agent" in spec) checkAgent(spec.agent, diagnostics);
  if ("model" in spec) checkModel(spec.model, diagnostics);
  if ("inputs" in spec) checkInputs(spec.inputs, diagnostics);
  if ("tools" in spec) checkTools(spec.tools, diagnostics);
  if ("locals" in spec) checkLocals(spec.locals, diagnostics);
  if ("model_context" in spec) checkModelContext(spec.model_context, diagnostics);
  if ("generation" in spec) checkGeneration(spec.generation, diagnostics, "/generation");
  if ("output" in spec) checkOutput(spec.output, diagnostics, "/output");
  checkAssumptions(spec.assumptions, diagnostics);
  if (patternOf(spec) === "react" && "react" in spec) checkReactShape(spec.react, diagnostics);
  return diagnostics;
}

function checkAgent(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (!checkRecord(value, "/agent", "agent", diagnostics)) return;
  checkRequiredString(value, "name", "/agent/name", diagnostics);
  checkRequiredString(value, "role", "/agent/role", diagnostics);
  checkRequiredString(value, "description", "/agent/description", diagnostics);
  if (typeof value.name === "string" && !AGENT_NAME_RE.test(value.name)) {
    diagnostics.push(
      error(
        "INVALID_IDENTIFIER",
        "/agent/name",
        "Agent name must start with an uppercase letter and contain only letters, digits, and underscores.",
      ),
    );
  }
}

function checkModel(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (!checkRecord(value, "/model", "model", diagnostics)) return;
  checkRequiredString(value, "import_name", "/model/import_name", diagnostics);
  checkRequiredString(value, "uri", "/model/uri", diagnostics);
  if (typeof value.import_name === "string") checkIdentifier(value.import_name, "/model/import_name", diagnostics);
}

function checkInputs(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (!checkRecord(value, "/inputs", "inputs", diagnostics)) return;
  const entries = Object.entries(value);
  if (entries.length === 0)
    diagnostics.push(error("EMPTY_VALUE", "/inputs", "inputs must contain at least one field."));
  for (const [name, input] of entries) {
    checkIdentifier(name, pointer("inputs", name), diagnostics);
    if (!checkRecord(input, pointer("inputs", name), `inputs.${name}`, diagnostics)) continue;
    checkTypeField(input.type, pointer("inputs", name, "type"), diagnostics);
    if ("required" in input && typeof input.required !== "boolean") {
      diagnostics.push(
        error("INVALID_TYPE", pointer("inputs", name, "required"), "required must be a boolean when present."),
      );
    }
  }
}

function checkTools(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (!checkArray(value, "/tools", "tools", diagnostics)) return;
  for (const [index, tool] of value.entries()) {
    if (!checkRecord(tool, pointer("tools", index), `tools[${index}]`, diagnostics)) continue;
    const base = pointer("tools", index);
    checkRequiredString(tool, "import_name", `${base}/import_name`, diagnostics);
    checkRequiredString(tool, "uri", `${base}/uri`, diagnostics);
    if (typeof tool.import_name === "string") checkIdentifier(tool.import_name, `${base}/import_name`, diagnostics);
    if (!Array.isArray(tool.methods)) {
      diagnostics.push(error("INVALID_SHAPE", `${base}/methods`, "tool methods must be an array."));
    } else if (tool.methods.length === 0) {
      diagnostics.push(error("EMPTY_VALUE", `${base}/methods`, "tool methods must contain at least one method."));
    }
    for (const [methodIndex, method] of arrayOf(tool.methods).entries()) {
      if (
        !checkRecord(
          method,
          pointer("tools", index, "methods", methodIndex),
          `tools[${index}].methods[${methodIndex}]`,
          diagnostics,
        )
      )
        continue;
      const methodBase = `${base}/methods/${methodIndex}`;
      checkRequiredString(method, "name", `${methodBase}/name`, diagnostics);
      checkRequiredString(method, "purpose", `${methodBase}/purpose`, diagnostics);
      if (typeof method.name === "string") checkIdentifier(method.name, `${methodBase}/name`, diagnostics);
    }
  }
}

function checkLocals(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (!checkArray(value, "/locals", "locals", diagnostics)) return;
  for (const [index, local] of value.entries()) {
    if (!checkRecord(local, pointer("locals", index), `locals[${index}]`, diagnostics)) continue;
    const base = pointer("locals", index);
    checkRequiredString(local, "name", `${base}/name`, diagnostics);
    if (typeof local.name === "string") checkIdentifier(local.name, `${base}/name`, diagnostics);
    if (!("source" in local))
      diagnostics.push(error("MISSING_FIELD", `${base}/source`, "Missing required field 'source'."));
    if (!checkRecord(local.source, `${base}/source`, `locals[${index}].source`, diagnostics)) continue;
    if (local.source.kind !== "tool_call") {
      diagnostics.push(error("UNSUPPORTED_KIND", `${base}/source/kind`, "locals source.kind must be 'tool_call'."));
    }
    checkRequiredString(local.source, "tool", `${base}/source/tool`, diagnostics);
    checkRequiredString(local.source, "method", `${base}/source/method`, diagnostics);
    if (!("args" in local.source))
      diagnostics.push(error("MISSING_FIELD", `${base}/source/args`, "Missing required field 'args'."));
    if (!checkRecord(local.source.args, `${base}/source/args`, `locals[${index}].source.args`, diagnostics)) continue;
    for (const [argName, argValue] of Object.entries(local.source.args)) {
      checkIdentifier(argName, `${base}/source/args/${argName}`, diagnostics);
      if (typeof argValue !== "string") {
        diagnostics.push(error("INVALID_TYPE", `${base}/source/args/${argName}`, "arg values must be strings."));
      }
    }
  }
}

function checkModelContext(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (!checkArray(value, "/model_context", "model_context", diagnostics)) return;
  for (const [index, context] of value.entries()) {
    if (!checkRecord(context, pointer("model_context", index), `model_context[${index}]`, diagnostics)) continue;
    const base = pointer("model_context", index);
    checkRequiredString(context, "source", `${base}/source`, diagnostics);
    checkRequiredString(context, "label", `${base}/label`, diagnostics);
    if ("max" in context && (typeof context.max !== "string" || !BUDGET_RE.test(context.max))) {
      diagnostics.push(error("INVALID_BUDGET_FORMAT", `${base}/max`, "max must match /^\\d+k?$/."));
    }
  }
}

function checkGeneration(value: unknown, diagnostics: SpecDiagnostic[], base: string): void {
  if (!checkRecord(value, base, base.slice(1), diagnostics)) return;
  checkRequiredString(value, "input", `${base}/input`, diagnostics);
  if ("max_output" in value && !isPositiveInteger(value.max_output)) {
    diagnostics.push(error("INVALID_VALUE", `${base}/max_output`, "max_output must be a positive integer."));
  }
}

function checkOutput(value: unknown, diagnostics: SpecDiagnostic[], base: string): void {
  if (!checkRecord(value, base, base.slice(1), diagnostics)) return;
  if (!("fields" in value)) {
    diagnostics.push(error("MISSING_FIELD", `${base}/fields`, "Missing required field 'fields'."));
    return;
  }
  const fields = outputFields(value);
  if (!fields) {
    diagnostics.push(error("INVALID_SHAPE", `${base}/fields`, "output.fields must be an object."));
    return;
  }
  if (Object.keys(fields).length === 0)
    diagnostics.push(error("EMPTY_VALUE", `${base}/fields`, "output.fields must contain at least one field."));
  for (const [name, field] of entriesOf(fields)) {
    checkIdentifier(name, `${base}/fields/${name}`, diagnostics);
    if (!isRecord(field)) continue;
    checkTypeField(field.type, `${base}/fields/${name}/type`, diagnostics);
  }
}

function checkReactShape(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (!checkRecord(value, "/react", "react", diagnostics)) return;
  if (!isPositiveInteger(value.max_iterations)) {
    diagnostics.push(
      error("INVALID_VALUE", "/react/max_iterations", "react.max_iterations must be a positive integer."),
    );
  }
  if (!("scratch" in value))
    diagnostics.push(error("MISSING_FIELD", "/react/scratch", "Missing required field 'scratch'."));
  if (checkRecord(value.scratch, "/react/scratch", "react.scratch", diagnostics)) {
    checkRequiredString(value.scratch, "label", "/react/scratch/label", diagnostics);
    if (typeof value.scratch.max !== "string" || !BUDGET_RE.test(value.scratch.max)) {
      diagnostics.push(
        error("INVALID_BUDGET_FORMAT", "/react/scratch/max", "react.scratch.max must match /^\\d+k?$/."),
      );
    }
  }
  if (!("reason" in value))
    diagnostics.push(error("MISSING_FIELD", "/react/reason", "Missing required field 'reason'."));
  if (checkRecord(value.reason, "/react/reason", "react.reason", diagnostics)) {
    checkGeneration(value.reason, diagnostics, "/react/reason");
    checkOutput(value.reason.output, diagnostics, "/react/reason/output");
  }
  if (!("act" in value)) diagnostics.push(error("MISSING_FIELD", "/react/act", "Missing required field 'act'."));
  if (checkRecord(value.act, "/react/act", "react.act", diagnostics)) {
    checkRequiredString(value.act, "tool", "/react/act/tool", diagnostics);
    checkRequiredString(value.act, "method", "/react/act/method", diagnostics);
    if (!("args" in value.act))
      diagnostics.push(error("MISSING_FIELD", "/react/act/args", "Missing required field 'args'."));
    if (checkRecord(value.act.args, "/react/act/args", "react.act.args", diagnostics)) {
      for (const [argName, argValue] of Object.entries(value.act.args)) {
        checkIdentifier(argName, `/react/act/args/${argName}`, diagnostics);
        if (typeof argValue !== "string") {
          diagnostics.push(error("INVALID_TYPE", `/react/act/args/${argName}`, "arg values must be strings."));
        }
      }
    }
  }
  checkRequiredString(value, "stop_when", "/react/stop_when", diagnostics);
}

function checkAssumptions(value: unknown, diagnostics: SpecDiagnostic[]): void {
  if (value === undefined || !Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      diagnostics.push(
        error("EMPTY_VALUE", pointer("assumptions", index), "assumptions entries must be non-empty strings."),
      );
    }
  });
}

function checkRequiredString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: SpecDiagnostic[],
): void {
  if (!(key in value)) {
    diagnostics.push(error("MISSING_FIELD", path, `Missing required field '${key}'.`));
    return;
  }
  if (!isNonEmptyString(value[key])) {
    diagnostics.push(error("EMPTY_VALUE", path, `${key} must be a non-empty string.`));
  }
}

function checkRecord(
  value: unknown,
  path: string,
  label: string,
  diagnostics: SpecDiagnostic[],
): value is Record<string, unknown> {
  if (isRecord(value)) return true;
  diagnostics.push(error("INVALID_SHAPE", path, `${label} must be an object.`));
  return false;
}

function checkArray(value: unknown, path: string, label: string, diagnostics: SpecDiagnostic[]): value is unknown[] {
  if (Array.isArray(value)) return true;
  diagnostics.push(error("INVALID_SHAPE", path, `${label} must be an array.`));
  return false;
}

function checkIdentifier(value: string, path: string, diagnostics: SpecDiagnostic[]): void {
  if (!IDENTIFIER_RE.test(value)) {
    diagnostics.push(error("INVALID_IDENTIFIER", path, "Identifier must match /^[A-Za-z_][A-Za-z0-9_]*$/."));
  }
}

function checkTypeField(value: unknown, path: string, diagnostics: SpecDiagnostic[]): void {
  if (value === undefined) {
    diagnostics.push(error("MISSING_FIELD", path, "Missing required field 'type'."));
    return;
  }
  if (typeof value !== "string") {
    diagnostics.push(error("INVALID_SHAPE", path, "type must be a string."));
    return;
  }
  if (!AGENT_SPEC_TYPES.has(value as never)) {
    diagnostics.push(error("UNSUPPORTED_TYPE", path, `Unsupported AgentSpec type '${value}'.`));
  }
}
