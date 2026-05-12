import type { AgentDecl, FuncDecl, Program } from "../ast/types.js";
import { errorDiagnostic, type SemanticDiagnostic } from "./diagnostics.js";
import type { ImportBindingDecl } from "./program.js";
import { collectShapeDiagnostics } from "./shape.js";
import { SemanticScope, functionBinding, isImportedBinding } from "./scope.js";

export function createAgentScope(program: Program, importBindings: Map<string, ImportBindingDecl>): SemanticScope {
  const agentScope = new SemanticScope();
  for (const [name, binding] of importBindings) {
    void agentScope.define(name, {
      kind: binding.kind,
      range: binding.range,
      agentName: binding.kind === "agent" ? name : undefined,
      uri: binding.uri,
    });
  }
  for (const localAgent of program.agents) {
    if (!agentScope.isLocalToThisScope(localAgent.name)) {
      void agentScope.define(localAgent.name, {
        kind: "agent",
        range: localAgent.range,
        agentName: localAgent.name,
      });
    }
  }
  return agentScope;
}

export function defineAgentFunctions(agent: AgentDecl, agentScope: SemanticScope): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const functionNames = new Set<string>();
  let mainFunc: FuncDecl | undefined;

  for (const fn of agent.functions) {
    if (functionNames.has(fn.name)) {
      diagnostics.push(
        errorDiagnostic("DUPLICATE_FUNCTION", `Duplicate function '${fn.name}' in agent '${agent.name}'`, fn.range),
      );
      continue;
    }
    if (fn.isMain) {
      if (mainFunc) {
        diagnostics.push(
          errorDiagnostic("DUPLICATE_MAIN_FUNC", `Agent '${agent.name}' can only have one main func`, fn.range),
        );
      }
      mainFunc = fn;
    }
    const existing = agentScope.resolve(fn.name);
    if (existing && existing.kind !== "function") {
      diagnostics.push(
        errorDiagnostic(
          "DUPLICATE_BINDING",
          `Function '${fn.name}' conflicts with an imported ${existing.kind}`,
          fn.range,
        ),
      );
      continue;
    }
    functionNames.add(fn.name);
    const defined = agentScope.define(fn.name, functionBinding(agent.name, fn));
    if (!defined.ok) {
      diagnostics.push(
        errorDiagnostic(
          "DUPLICATE_BINDING",
          `Function '${fn.name}' conflicts with an existing ${defined.existing.kind}`,
          fn.range,
        ),
      );
    }
  }

  return diagnostics;
}

export function createFunctionScope(
  fn: FuncDecl,
  agentScope: SemanticScope,
): {
  scope: SemanticScope;
  diagnostics: SemanticDiagnostic[];
} {
  const scope = agentScope.child();
  const diagnostics: SemanticDiagnostic[] = [];
  const params = new Set<string>();

  for (const [index, param] of fn.params.entries()) {
    if (params.has(param.name)) {
      diagnostics.push(
        errorDiagnostic("DUPLICATE_PARAM", `Duplicate parameter '${param.name}' in function '${fn.name}'`, param.range),
      );
      continue;
    }
    params.add(param.name);
    const existing = scope.resolve(param.name);
    if (existing && isImportedBinding(existing.kind)) {
      diagnostics.push(
        errorDiagnostic(
          "PARAM_SHADOWS_IMPORT",
          `Parameter '${param.name}' conflicts with an imported ${existing.kind}`,
          param.range,
        ),
      );
    }
    const defined = scope.define(param.name, { kind: "param", range: param.range });
    if (!defined.ok) {
      diagnostics.push(
        errorDiagnostic(
          "DUPLICATE_BINDING",
          `Parameter '${param.name}' conflicts with an existing ${defined.existing.kind}`,
          param.range,
        ),
      );
    }
    if (param.shape) {
      if (!fn.isMain || index !== 0 || param.name !== "input") {
        diagnostics.push(
          errorDiagnostic(
            "INVALID_PARAM_SHAPE",
            "Shape declarations are currently only supported on the main func input parameter",
            param.range,
          ),
        );
      }
      diagnostics.push(...collectShapeDiagnostics(param.shape));
    }
  }

  return { scope, diagnostics };
}
