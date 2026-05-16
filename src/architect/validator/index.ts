import type {
  AgentSpec,
  AgentSpecAgent,
  AgentSpecContext,
  AgentSpecDraft,
  AgentSpecGeneration,
  AgentSpecInput,
  AgentSpecLocal,
  AgentSpecLocalSource,
  AgentSpecMethod,
  AgentSpecModel,
  AgentSpecOutput,
  AgentSpecOutputField,
  AgentSpecReact,
  AgentSpecTool,
  AgentSpecType,
  LinearAgentSpec,
  ReactAgentSpec,
} from "../spec/types.js";
import { checkBindings } from "./binding-check.js";
import { checkContext } from "./context-check.js";
import { type SpecDiagnostic, type ValidateResult, isRecord, okFromDiagnostics } from "./helpers.js";
import { checkPattern } from "./pattern-check.js";
import { checkReact } from "./react-check.js";
import { checkReferences } from "./reference-check.js";
import { checkSchema } from "./schema-check.js";
import { checkTypes } from "./type-check.js";

export type { SpecDiagnostic, ValidateResult } from "./helpers.js";

type TypedValidateResult =
  | { ok: true; spec: AgentSpec; diagnostics: SpecDiagnostic[] }
  | { ok: false; diagnostics: SpecDiagnostic[] };

export function validateSpec(spec: AgentSpecDraft): ValidateResult {
  const diagnostics: SpecDiagnostic[] = [
    ...checkPattern(spec),
    ...checkSchema(spec),
    ...checkTypes(spec),
    ...checkBindings(spec),
    ...checkReferences(spec),
    ...checkContext(spec),
    ...checkReact(spec),
  ];
  return { ok: okFromDiagnostics(diagnostics), diagnostics };
}

export function validateTypedSpec(spec: AgentSpecDraft): TypedValidateResult {
  const validation = validateSpec(spec);
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };
  return { ok: true, spec: readAgentSpec(spec), diagnostics: validation.diagnostics };
}

function readAgentSpec(spec: AgentSpecDraft): AgentSpec {
  const base = {
    version: readLiteral(spec.version, "0.1", "/version"),
    agent: readAgent(spec.agent),
    model: readModel(spec.model),
    inputs: readInputs(spec.inputs),
    tools: readTools(spec.tools),
    locals: readLocals(spec.locals),
    model_context: readModelContext(spec.model_context),
    generation: readGeneration(spec.generation, "/generation"),
    output: readOutput(spec.output, "/output"),
    assumptions: readOptionalStringArray(spec.assumptions, "/assumptions"),
  };
  if (spec.pattern === "react") {
    const react: ReactAgentSpec = {
      ...base,
      pattern: "react",
      react: readReact(spec.react),
    };
    return react;
  }
  const linear: LinearAgentSpec = spec.pattern === "linear" ? { ...base, pattern: "linear" } : base;
  return linear;
}

function readAgent(value: unknown): AgentSpecAgent {
  const record = readRecord(value, "/agent");
  return {
    name: readString(record.name, "/agent/name"),
    role: readString(record.role, "/agent/role"),
    description: readString(record.description, "/agent/description"),
  };
}

function readModel(value: unknown): AgentSpecModel {
  const record = readRecord(value, "/model");
  return {
    import_name: readString(record.import_name, "/model/import_name"),
    uri: readString(record.uri, "/model/uri"),
  };
}

function readInputs(value: unknown): Record<string, AgentSpecInput> {
  const record = readRecord(value, "/inputs");
  const inputs: Record<string, AgentSpecInput> = {};
  for (const [name, input] of Object.entries(record)) {
    const inputRecord = readRecord(input, `/inputs/${name}`);
    const required = inputRecord.required;
    inputs[name] = {
      type: readSpecType(inputRecord.type, `/inputs/${name}/type`),
      ...(required === undefined ? {} : { required: readBoolean(required, `/inputs/${name}/required`) }),
    };
  }
  return inputs;
}

function readTools(value: unknown): AgentSpecTool[] {
  return readArray(value, "/tools").map((tool, index) => {
    const record = readRecord(tool, `/tools/${index}`);
    return {
      import_name: readString(record.import_name, `/tools/${index}/import_name`),
      uri: readString(record.uri, `/tools/${index}/uri`),
      methods: readArray(record.methods, `/tools/${index}/methods`).map((method, methodIndex) =>
        readMethod(method, `/tools/${index}/methods/${methodIndex}`),
      ),
    };
  });
}

function readMethod(value: unknown, path: string): AgentSpecMethod {
  const record = readRecord(value, path);
  return {
    name: readString(record.name, `${path}/name`),
    purpose: readString(record.purpose, `${path}/purpose`),
  };
}

function readLocals(value: unknown): AgentSpecLocal[] {
  return readArray(value, "/locals").map((local, index) => {
    const path = `/locals/${index}`;
    const record = readRecord(local, path);
    return {
      name: readString(record.name, `${path}/name`),
      source: readLocalSource(record.source, `${path}/source`),
    };
  });
}

function readLocalSource(value: unknown, path: string): AgentSpecLocalSource {
  const record = readRecord(value, path);
  return {
    kind: readLiteral(record.kind, "tool_call", `${path}/kind`),
    tool: readString(record.tool, `${path}/tool`),
    method: readString(record.method, `${path}/method`),
    args: readStringRecord(record.args, `${path}/args`),
  };
}

function readModelContext(value: unknown): AgentSpecContext[] {
  return readArray(value, "/model_context").map((context, index) => {
    const path = `/model_context/${index}`;
    const record = readRecord(context, path);
    const max = record.max;
    return {
      source: readString(record.source, `${path}/source`),
      label: readString(record.label, `${path}/label`),
      ...(max === undefined ? {} : { max: readString(max, `${path}/max`) }),
    };
  });
}

function readGeneration(value: unknown, path: string): AgentSpecGeneration {
  const record = readRecord(value, path);
  const maxOutput = record.max_output;
  return {
    input: readString(record.input, `${path}/input`),
    ...(maxOutput === undefined ? {} : { max_output: readNumber(maxOutput, `${path}/max_output`) }),
  };
}

function readOutput(value: unknown, path: string): AgentSpecOutput {
  const record = readRecord(value, path);
  const fields = readRecord(record.fields, `${path}/fields`);
  const typedFields: Record<string, AgentSpecOutputField> = {};
  for (const [name, field] of Object.entries(fields)) {
    typedFields[name] = readOutputField(field, `${path}/fields/${name}`);
  }
  return { fields: typedFields };
}

function readOutputField(value: unknown, path: string): AgentSpecOutputField {
  const record = readRecord(value, path);
  return { type: readSpecType(record.type, `${path}/type`) };
}

function readReact(value: unknown): AgentSpecReact {
  const record = readRecord(value, "/react");
  const scratch = readRecord(record.scratch, "/react/scratch");
  const reason = readRecord(record.reason, "/react/reason");
  const act = readRecord(record.act, "/react/act");
  return {
    max_iterations: readNumber(record.max_iterations, "/react/max_iterations"),
    scratch: {
      label: readString(scratch.label, "/react/scratch/label"),
      max: readString(scratch.max, "/react/scratch/max"),
    },
    reason: {
      input: readString(reason.input, "/react/reason/input"),
      output: readOutput(reason.output, "/react/reason/output"),
    },
    act: {
      tool: readString(act.tool, "/react/act/tool"),
      method: readString(act.method, "/react/act/method"),
      args: readStringRecord(act.args, "/react/act/args"),
    },
    stop_when: readString(record.stop_when, "/react/stop_when"),
  };
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`Validated AgentSpec field '${path}' is not an object`);
}

function readArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`Validated AgentSpec field '${path}' is not an array`);
}

function readString(value: unknown, path: string): string {
  if (typeof value === "string") return value;
  throw new Error(`Validated AgentSpec field '${path}' is not a string`);
}

function readNumber(value: unknown, path: string): number {
  if (typeof value === "number") return value;
  throw new Error(`Validated AgentSpec field '${path}' is not a number`);
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`Validated AgentSpec field '${path}' is not a boolean`);
}

function readLiteral<T extends string>(value: unknown, expected: T, path: string): T {
  if (value === expected) return expected;
  throw new Error(`Validated AgentSpec field '${path}' is not '${expected}'`);
}

function readStringRecord(value: unknown, path: string): Record<string, string> {
  const record = readRecord(value, path);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    result[key] = readString(item, `${path}/${key}`);
  }
  return result;
}

function readOptionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  return readArray(value, path).map((item, index) => readString(item, `${path}/${index}`));
}

function readSpecType(value: unknown, path: string): AgentSpecType {
  switch (value) {
    case "string":
    case "number":
    case "boolean":
    case "json":
    case "list[string]":
    case "list[number]":
    case "list[boolean]":
    case "list[json]":
      return value;
    default:
      throw new Error(`Validated AgentSpec field '${path}' is not a supported type`);
  }
}
