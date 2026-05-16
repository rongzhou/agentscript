import type { AgentSpecDraft } from "../spec/schema.js";
import { entriesOf, error, isRecord, patternOf, pointer, type SpecDiagnostic } from "./helpers.js";

export interface ReferenceIndex {
  inputs: Set<string>;
  locals: Set<string>;
  tools: Map<string, Set<string>>;
}

export function buildReferenceIndex(spec: AgentSpecDraft): ReferenceIndex {
  const tools = new Map<string, Set<string>>();
  for (const tool of Array.isArray(spec.tools) ? spec.tools : []) {
    if (!isRecord(tool) || typeof tool.import_name !== "string") continue;
    const methods = new Set<string>();
    for (const method of Array.isArray(tool.methods) ? tool.methods : []) {
      if (isRecord(method) && typeof method.name === "string") methods.add(method.name);
    }
    tools.set(tool.import_name, methods);
  }
  const inputs = new Set(Object.keys(isRecord(spec.inputs) ? spec.inputs : {}));
  const locals = new Set<string>();
  for (const local of Array.isArray(spec.locals) ? spec.locals : []) {
    if (isRecord(local) && typeof local.name === "string") locals.add(local.name);
  }
  return { inputs, locals, tools };
}

export function checkReferences(spec: AgentSpecDraft): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  const index = buildReferenceIndex(spec);
  const declaredLocals = new Set<string>();
  for (const [localIndex, local] of (Array.isArray(spec.locals) ? spec.locals : []).entries()) {
    if (!isRecord(local) || !isRecord(local.source)) continue;
    checkToolMethod(
      local.source.tool,
      local.source.method,
      pointer("locals", localIndex, "source"),
      index,
      diagnostics,
    );
    for (const [argName, argValue] of entriesOf(local.source.args)) {
      if (typeof argValue !== "string") continue;
      checkInputLocalRef(
        argValue,
        pointer("locals", localIndex, "source", "args", argName),
        index,
        diagnostics,
        declaredLocals,
      );
    }
    if (typeof local.name === "string") declaredLocals.add(local.name);
  }
  if (patternOf(spec) === "react" && isRecord(spec.react) && isRecord(spec.react.act)) {
    checkToolMethod(spec.react.act.tool, spec.react.act.method, "/react/act", index, diagnostics);
    for (const [argName, argValue] of entriesOf(spec.react.act.args)) {
      if (typeof argValue !== "string" || argValue.startsWith("thought.")) continue;
      checkInputLocalRef(argValue, pointer("react", "act", "args", argName), index, diagnostics);
    }
  }
  return diagnostics;
}

export function checkInputLocalRef(
  value: string,
  path: string,
  index: ReferenceIndex,
  diagnostics: SpecDiagnostic[],
  availableLocals = index.locals,
): void {
  if (value.startsWith("input.")) {
    const name = value.slice("input.".length);
    if (!index.inputs.has(name))
      diagnostics.push(error("UNKNOWN_INPUT_REF", path, `Unknown input reference '${value}'.`));
    return;
  }
  if (value.startsWith("local.")) {
    const name = value.slice("local.".length);
    if (!index.locals.has(name)) {
      diagnostics.push(error("UNKNOWN_LOCAL_REF", path, `Unknown local reference '${value}'.`));
    } else if (!availableLocals.has(name)) {
      diagnostics.push(error("FORWARD_LOCAL_REF", path, `Local '${name}' is referenced before it is declared.`));
    }
  }
}

function checkToolMethod(
  tool: unknown,
  method: unknown,
  path: string,
  index: ReferenceIndex,
  diagnostics: SpecDiagnostic[],
): void {
  if (typeof tool !== "string") return;
  const methods = index.tools.get(tool);
  if (!methods) {
    diagnostics.push(error("UNKNOWN_TOOL", `${path}/tool`, `Unknown tool '${tool}'.`));
    return;
  }
  if (typeof method === "string" && !methods.has(method)) {
    diagnostics.push(error("UNKNOWN_TOOL_METHOD", `${path}/method`, `Tool '${tool}' has no method '${method}'.`));
  }
}
