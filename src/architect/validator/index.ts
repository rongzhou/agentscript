import {
  isAgentSpecPattern,
  isAgentSpecType,
  type AgentSpec,
  type AgentSpecAgent,
  type AgentSpecBase,
  type AgentSpecContext,
  type AgentSpecDraft,
  type AgentSpecGeneration,
  type AgentSpecInput,
  type AgentSpecLocal,
  type AgentSpecLocalSource,
  type AgentSpecMethod,
  type AgentSpecModel,
  type AgentSpecOutput,
  type AgentSpecOutputField,
  type AgentSpecPattern,
  type AgentSpecReact,
  type AgentSpecTool,
  type AgentSpecType,
} from "../spec/types.js";
import { checkBindings } from "./binding-check.js";
import { checkContext } from "./context-check.js";
import { isRecord, type SpecDiagnostic, type ValidateResult, okFromDiagnostics } from "./helpers.js";
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
  return { ok: true, spec: normalizeAgentSpec(spec), diagnostics: validation.diagnostics };
}

function normalizeAgentSpec(spec: AgentSpecDraft): AgentSpec {
  const pattern = normalizedPattern(spec.pattern);
  const base = normalizedBaseSpec(spec);
  if (pattern === "react") {
    return { ...base, pattern, react: normalizedReact(spec.react) };
  }
  if (spec.pattern === undefined) return base;
  return { ...base, pattern };
}

function normalizedBaseSpec(spec: AgentSpecDraft): Omit<AgentSpecBase, "pattern"> {
  return {
    version: "0.1",
    agent: normalizedAgent(spec.agent),
    model: normalizedModel(spec.model),
    inputs: normalizedInputs(spec.inputs),
    tools: normalizedTools(spec.tools),
    locals: normalizedLocals(spec.locals),
    model_context: normalizedModelContext(spec.model_context),
    generation: normalizedGeneration(spec.generation),
    output: normalizedOutput(spec.output),
    ...(spec.assumptions === undefined ? {} : { assumptions: normalizedStringArray(spec.assumptions, "assumptions") }),
  };
}

function normalizedPattern(value: unknown): AgentSpecPattern {
  if (value === undefined) return "linear";
  if (typeof value === "string" && isAgentSpecPattern(value)) return value;
  throw invalidValidatedSpec("pattern");
}

function normalizedAgent(value: unknown): AgentSpecAgent {
  const agent = expectRecord(value, "agent");
  return {
    name: expectString(agent.name, "agent.name"),
    role: expectString(agent.role, "agent.role"),
    description: expectString(agent.description, "agent.description"),
  };
}

function normalizedModel(value: unknown): AgentSpecModel {
  const model = expectRecord(value, "model");
  return {
    import_name: expectString(model.import_name, "model.import_name"),
    uri: expectString(model.uri, "model.uri"),
  };
}

function normalizedInputs(value: unknown): Record<string, AgentSpecInput> {
  const inputs: Record<string, AgentSpecInput> = {};
  for (const [name, input] of Object.entries(expectRecord(value, "inputs"))) {
    const record = expectRecord(input, `inputs.${name}`);
    inputs[name] = {
      type: expectSpecType(record.type, `inputs.${name}.type`),
      ...(record.required === undefined ? {} : { required: expectBoolean(record.required, `inputs.${name}.required`) }),
    };
  }
  return inputs;
}

function normalizedTools(value: unknown): AgentSpecTool[] {
  return expectArray(value, "tools").map((tool, index) => {
    const record = expectRecord(tool, `tools[${index}]`);
    return {
      import_name: expectString(record.import_name, `tools[${index}].import_name`),
      uri: expectString(record.uri, `tools[${index}].uri`),
      methods: normalizedMethods(record.methods, index),
    };
  });
}

function normalizedMethods(value: unknown, toolIndex: number): AgentSpecMethod[] {
  return expectArray(value, `tools[${toolIndex}].methods`).map((method, methodIndex) => {
    const record = expectRecord(method, `tools[${toolIndex}].methods[${methodIndex}]`);
    return {
      name: expectString(record.name, `tools[${toolIndex}].methods[${methodIndex}].name`),
      purpose: expectString(record.purpose, `tools[${toolIndex}].methods[${methodIndex}].purpose`),
    };
  });
}

function normalizedLocals(value: unknown): AgentSpecLocal[] {
  return expectArray(value, "locals").map((local, index) => {
    const record = expectRecord(local, `locals[${index}]`);
    return {
      name: expectString(record.name, `locals[${index}].name`),
      source: normalizedLocalSource(record.source, index),
    };
  });
}

function normalizedLocalSource(value: unknown, localIndex: number): AgentSpecLocalSource {
  const source = expectRecord(value, `locals[${localIndex}].source`);
  if (source.kind !== "tool_call") throw invalidValidatedSpec(`locals[${localIndex}].source.kind`);
  return {
    kind: "tool_call",
    tool: expectString(source.tool, `locals[${localIndex}].source.tool`),
    method: expectString(source.method, `locals[${localIndex}].source.method`),
    args: normalizedStringRecord(source.args, `locals[${localIndex}].source.args`),
  };
}

function normalizedModelContext(value: unknown): AgentSpecContext[] {
  return expectArray(value, "model_context").map((context, index) => {
    const record = expectRecord(context, `model_context[${index}]`);
    return {
      source: expectString(record.source, `model_context[${index}].source`),
      label: expectString(record.label, `model_context[${index}].label`),
      ...(record.max === undefined ? {} : { max: expectString(record.max, `model_context[${index}].max`) }),
    };
  });
}

function normalizedGeneration(value: unknown): AgentSpecGeneration {
  const generation = expectRecord(value, "generation");
  return {
    input: expectString(generation.input, "generation.input"),
    ...(generation.max_output === undefined
      ? {}
      : { max_output: expectNumber(generation.max_output, "generation.max_output") }),
  };
}

function normalizedOutput(value: unknown): AgentSpecOutput {
  const output = expectRecord(value, "output");
  return { fields: normalizedOutputFields(output.fields, "output.fields") };
}

function normalizedOutputFields(value: unknown, label: string): Record<string, AgentSpecOutputField> {
  const fields: Record<string, AgentSpecOutputField> = {};
  for (const [name, field] of Object.entries(expectRecord(value, label))) {
    const record = expectRecord(field, `${label}.${name}`);
    fields[name] = { type: expectSpecType(record.type, `${label}.${name}.type`) };
  }
  return fields;
}

function normalizedReact(value: unknown): AgentSpecReact {
  const react = expectRecord(value, "react");
  const scratch = expectRecord(react.scratch, "react.scratch");
  const reason = expectRecord(react.reason, "react.reason");
  const act = expectRecord(react.act, "react.act");
  return {
    max_iterations: expectNumber(react.max_iterations, "react.max_iterations"),
    scratch: {
      label: expectString(scratch.label, "react.scratch.label"),
      max: expectString(scratch.max, "react.scratch.max"),
    },
    reason: {
      input: expectString(reason.input, "react.reason.input"),
      ...(reason.max_output === undefined
        ? {}
        : { max_output: expectNumber(reason.max_output, "react.reason.max_output") }),
      output: {
        fields: normalizedOutputFields(
          expectRecord(reason.output, "react.reason.output").fields,
          "react.reason.output.fields",
        ),
      },
    },
    act: {
      tool: expectString(act.tool, "react.act.tool"),
      method: expectString(act.method, "react.act.method"),
      args: normalizedStringRecord(act.args, "react.act.args"),
    },
    stop_when: expectString(react.stop_when, "react.stop_when"),
  };
}

function normalizedStringArray(value: unknown, label: string): string[] {
  return expectArray(value, label).map((item, index) => expectString(item, `${label}[${index}]`));
}

function normalizedStringRecord(value: unknown, label: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(expectRecord(value, label))) {
    record[key] = expectString(item, `${label}.${key}`);
  }
  return record;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw invalidValidatedSpec(label);
}

function expectArray(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw invalidValidatedSpec(label);
}

function expectString(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  throw invalidValidatedSpec(label);
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw invalidValidatedSpec(label);
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value === "number") return value;
  throw invalidValidatedSpec(label);
}

function expectSpecType(value: unknown, label: string): AgentSpecType {
  if (typeof value === "string" && isAgentSpecType(value)) return value;
  throw invalidValidatedSpec(label);
}

function invalidValidatedSpec(label: string): Error {
  return new Error(`validated AgentSpec is invalid at ${label}`);
}
