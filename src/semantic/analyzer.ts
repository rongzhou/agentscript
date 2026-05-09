import type {
  AgentDecl,
  AssignStmt,
  CallExpr,
  ConfigDecl,
  ConfigKey,
  ConfigStmt,
  Expr,
  FuncDecl,
  GenerateExpr,
  ListShapeType,
  MemberExpr,
  NamedShapeType,
  Program,
  RepeatStmt,
  ShapeObjectExpr,
  ShapeTypeExpr,
  SourceRange,
  Stmt,
} from "../ast/types.js";
import { SHAPE_TYPE_NAMES } from "../ast/constants.js";
import { SemanticError, type SemanticDiagnostic, type SemanticResult } from "./diagnostics.js";

type BindingKind = "param" | "local" | "function" | "tool" | "llm" | "file" | "agent" | "memory";

interface Binding {
  kind: BindingKind;
  range: SourceRange;
  agentName?: string;
  functionName?: string;
  arity?: number;
}

class SemanticScope {
  private readonly bindings = new Map<string, Binding>();
  private readonly configs = new Set<ConfigKey>();

  constructor(private readonly parent?: SemanticScope) {}

  define(name: string, binding: Binding): boolean {
    if (this.bindings.has(name)) {
      return false;
    }
    this.bindings.set(name, binding);
    return true;
  }

  hasLocal(name: string): boolean {
    return this.bindings.has(name);
  }

  isLocalToThisScope(name: string): boolean {
    return this.bindings.has(name);
  }

  resolve(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.resolve(name);
  }

  defineConfig(name: ConfigKey): void {
    this.configs.add(name);
  }

  hasConfig(name: ConfigKey): boolean {
    return this.configs.has(name) || this.parent?.hasConfig(name) === true;
  }

  child(): SemanticScope {
    return new SemanticScope(this);
  }
}

export function analyze(program: Program): SemanticResult {
  const analyzer = new Analyzer();
  return analyzer.analyze(program);
}

export function assertSemanticallyValid(program: Program): SemanticResult {
  const result = analyze(program);
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new SemanticError(errors);
  }
  return result;
}

class Analyzer {
  private diagnostics: SemanticDiagnostic[] = [];
  private agentDecls = new Map<string, AgentDecl>();
  private readonly importBindings = new Map<string, { kind: BindingKind; range: SourceRange }>();
  private agents = new Map<string, SourceRange>();

  analyze(program: Program): SemanticResult {
    this.checkImports(program);
    this.checkAgents(program);
    return { diagnostics: this.diagnostics };
  }

  private checkImports(program: Program): void {
    for (const imported of program.imports) {
      if (this.importBindings.has(imported.name)) {
        this.error("DUPLICATE_IMPORT", `Duplicate import '${imported.name}'`, imported.range);
        continue;
      }
      const kind = importResourceKindToBindingKind(imported.resourceKind);
      this.importBindings.set(imported.name, { kind, range: imported.range });
      if (imported.resourceKind === "agent") {
        this.agents.set(imported.name, imported.range);
      }
    }
  }

  private checkAgents(program: Program): void {
    let mainAgent: AgentDecl | undefined;
    const seenNames = new Set<string>();
    for (const agent of program.agents) {
      if (seenNames.has(agent.name)) {
        this.error("DUPLICATE_AGENT", `Duplicate agent '${agent.name}'`, agent.range);
      }
      seenNames.add(agent.name);
      this.agentDecls.set(agent.name, agent);
      this.agents.set(agent.name, agent.range);
      if (agent.isMain) {
        if (mainAgent) {
          this.error("DUPLICATE_MAIN_AGENT", "Program can only have one main agent", agent.range);
        }
        mainAgent = agent;
      }
    }

    if (!mainAgent && program.agents.length > 1) {
      this.error("MISSING_MAIN_AGENT", "Program with multiple agents must declare one main agent", program.range);
    }

    const entryAgent = mainAgent ?? (program.agents.length === 1 ? program.agents[0] : undefined);
    if (entryAgent && !entryAgent.functions.some((fn) => fn.isMain)) {
      this.error("MISSING_MAIN_FUNC", "Entry agent must declare one main func", entryAgent.range);
    }

    for (const agent of program.agents) {
      this.checkAgent(agent);
    }
  }

  private checkAgent(agent: AgentDecl): void {
    const agentScope = new SemanticScope();
    for (const [name, binding] of this.importBindings) {
      agentScope.define(name, {
        kind: binding.kind,
        range: binding.range,
        agentName: binding.kind === "agent" ? name : undefined,
      });
    }
    for (const [name, range] of this.agents) {
      if (!agentScope.hasLocal(name)) {
        agentScope.define(name, { kind: "agent", range, agentName: name });
      }
    }

    const functionNames = new Set<string>();
    let mainFunc: FuncDecl | undefined;
    for (const fn of agent.functions) {
      if (functionNames.has(fn.name)) {
        this.error("DUPLICATE_FUNCTION", `Duplicate function '${fn.name}' in agent '${agent.name}'`, fn.range);
        continue;
      }
      if (fn.isMain) {
        if (mainFunc) {
          this.error("DUPLICATE_MAIN_FUNC", `Agent '${agent.name}' can only have one main func`, fn.range);
        }
        mainFunc = fn;
      }
      const existing = agentScope.resolve(fn.name);
      if (existing && existing.kind !== "function") {
        this.error("DUPLICATE_BINDING", `Function '${fn.name}' conflicts with an imported ${existing.kind}`, fn.range);
        continue;
      }
      functionNames.add(fn.name);
      agentScope.define(fn.name, functionBinding(agent.name, fn));
    }

    for (const config of agent.config) {
      this.checkConfig(config, agentScope);
    }

    for (const fn of agent.functions) {
      this.checkFunction(fn, agentScope);
    }
  }

  private checkFunction(fn: FuncDecl, agentScope: SemanticScope): void {
    const scope = agentScope.child();
    const params = new Set<string>();

    for (const [index, param] of fn.params.entries()) {
      if (params.has(param.name)) {
        this.error("DUPLICATE_PARAM", `Duplicate parameter '${param.name}' in function '${fn.name}'`, param.range);
        continue;
      }
      params.add(param.name);
      const existing = scope.resolve(param.name);
      if (existing && isImportedBinding(existing.kind)) {
        this.error(
          "PARAM_SHADOWS_IMPORT",
          `Parameter '${param.name}' conflicts with an imported ${existing.kind}`,
          param.range,
        );
      }
      scope.define(param.name, { kind: "param", range: param.range });
      if (param.shape) {
        if (!fn.isMain || index !== 0 || param.name !== "input") {
          this.error(
            "INVALID_PARAM_SHAPE",
            "V0 only supports shape declarations on the main func input parameter",
            param.range,
          );
        }
        this.checkShapeObject(param.shape);
      }
    }

    for (const stmt of fn.body) {
      this.checkStatement(stmt, scope);
    }
  }

  private checkStatement(stmt: Stmt, scope: SemanticScope): void {
    switch (stmt.kind) {
      case "ConfigStmt":
        this.checkConfig(stmt, scope);
        break;
      case "UseStmt":
        this.checkExpression(stmt.value, scope);
        this.checkUseValue(stmt.value, scope);
        if (stmt.budget && stmt.budget.amount <= 0) {
          this.error("INVALID_BUDGET", "Budget amount must be greater than 0", stmt.range);
        }
        if (stmt.label && RESERVED_CONTEXT_LABELS.has(stmt.label)) {
          this.error("RESERVED_CONTEXT_LABEL", `Context label '${stmt.label}' is reserved`, stmt.range);
        }
        break;
      case "AssignStmt":
        this.checkAssignment(stmt, scope);
        break;
      case "ExprStmt":
        this.checkExpression(stmt.expr, scope);
        break;
      case "IfStmt":
        this.checkExpression(stmt.condition, scope);
        this.checkBlock(stmt.thenBody, scope.child());
        if (stmt.elseBody) {
          this.checkBlock(stmt.elseBody, scope.child());
        }
        break;
      case "ForInStmt": {
        this.checkExpression(stmt.iterable, scope);
        if (stmt.maxIterations <= 0) {
          this.error("INVALID_ITERATION_LIMIT", "For iteration count must be greater than 0", stmt.range);
        }
        const child = scope.child();
        child.define(stmt.itemName, { kind: "local", range: stmt.itemRange });
        this.checkBlock(stmt.body, child);
        break;
      }
      case "LoopUntilStmt":
        this.checkExpression(stmt.condition, scope);
        this.checkBlock(stmt.body, scope.child());
        break;
      case "RepeatStmt":
        this.checkRepeat(stmt, scope);
        break;
      case "ReturnStmt":
        this.checkExpression(stmt.value, scope);
        break;
    }
  }

  private checkConfig(config: ConfigDecl | ConfigStmt, scope: SemanticScope): void {
    scope.defineConfig(config.key);
    switch (config.key) {
      case "model": {
        if (config.value.kind !== "IdentifierExpr") {
          this.error("INVALID_CONFIG", "model must reference an imported llm name", config.value.range);
          return;
        }
        const binding = scope.resolve(config.value.name);
        if (!binding) {
          this.error("UNKNOWN_MODEL", `Unknown model import '${config.value.name}'`, config.value.range);
        } else if (binding.kind !== "llm") {
          this.error("INVALID_MODEL", `model must reference an imported llm`, config.value.range);
        }
        return;
      }
      case "role":
      case "description":
        if (config.value.kind !== "StringExpr") {
          this.error("INVALID_CONFIG", `${config.key} must be a string`, config.value.range);
        }
        return;
    }
  }

  private checkBlock(statements: Stmt[], scope: SemanticScope): void {
    for (const stmt of statements) {
      this.checkStatement(stmt, scope);
    }
  }

  private checkRepeat(stmt: RepeatStmt, scope: SemanticScope): void {
    this.checkBlock(stmt.body, scope.child());
  }

  private checkAssignment(stmt: AssignStmt, scope: SemanticScope): void {
    this.checkExpression(stmt.value, scope);

    if (stmt.target.kind === "IdentifierExpr") {
      if (!scope.hasLocal(stmt.target.name)) {
        scope.define(stmt.target.name, { kind: "local", range: stmt.target.range });
      }
      return;
    }

    if (stmt.target.kind === "MemberExpr") {
      this.checkExpression(stmt.target.object, scope);
      return;
    }

    this.error(
      "INVALID_ASSIGNMENT_TARGET",
      "Assignment target must be an identifier or member expression",
      stmt.target.range,
    );
  }

  private checkExpression(expr: Expr, scope: SemanticScope): void {
    switch (expr.kind) {
      case "IdentifierExpr":
        this.checkIdentifier(expr.name, expr.range, scope);
        break;
      case "StringExpr":
      case "NumberExpr":
      case "BooleanExpr":
      case "NullExpr":
        break;
      case "ListExpr":
        for (const item of expr.items) {
          this.checkExpression(item, scope);
        }
        break;
      case "ObjectExpr":
        for (const property of expr.properties) {
          this.checkExpression(property.value, scope);
        }
        break;
      case "ShapeObjectExpr":
        this.checkShapeObject(expr);
        break;
      case "MemberExpr":
        this.checkMember(expr, scope);
        break;
      case "IndexExpr":
        this.checkExpression(expr.object, scope);
        this.checkExpression(expr.index, scope);
        break;
      case "UnaryExpr":
        this.checkExpression(expr.value, scope);
        break;
      case "BinaryExpr":
        this.checkExpression(expr.left, scope);
        this.checkExpression(expr.right, scope);
        break;
      case "CallExpr":
        this.checkCall(expr, scope);
        break;
      case "GenerateExpr":
        this.checkGenerate(expr, scope);
        break;
      case "ParallelForExpr":
        this.checkParallelFor(expr, scope);
        break;
    }
  }

  private checkParallelFor(expr: Extract<Expr, { kind: "ParallelForExpr" }>, scope: SemanticScope): void {
    this.checkExpression(expr.iterable, scope);
    if (expr.maxIterations <= 0) {
      this.error("INVALID_PARALLEL_FOR_LIMIT", "parallel for item count must be greater than 0", expr.range);
    }
    if (!this.blockEndsWithExpression(expr.body)) {
      this.error("INVALID_PARALLEL_FOR_BODY", "parallel for body must end with a value expression", expr.range);
    }
    const child = scope.child();
    child.define(expr.itemName, { kind: "local", range: expr.itemRange });
    this.checkParallelForBody(expr.body, child);
  }

  private blockEndsWithExpression(statements: Stmt[]): boolean {
    return statements.length > 0 && statements[statements.length - 1]?.kind === "ExprStmt";
  }

  private checkParallelForBody(statements: Stmt[], scope: SemanticScope): void {
    for (const stmt of statements) {
      if (stmt.kind === "AssignStmt" && stmt.target.kind === "IdentifierExpr") {
        const binding = scope.resolve(stmt.target.name);
        if (binding && !scope.isLocalToThisScope(stmt.target.name)) {
          this.error(
            "PARALLEL_FOR_OUTER_ASSIGNMENT",
            `parallel for body cannot assign to outer variable '${stmt.target.name}'`,
            stmt.target.range,
          );
        }
      }
      if (
        stmt.kind === "ExprStmt" &&
        stmt.expr.kind === "CallExpr" &&
        stmt.expr.callee.kind === "MemberExpr" &&
        stmt.expr.callee.object.kind === "IdentifierExpr"
      ) {
        const root = stmt.expr.callee.object.name;
        const binding = scope.resolve(root);
        if (binding?.kind === "memory" && stmt.expr.callee.property === "add") {
          this.error(
            "PARALLEL_FOR_EFFECTFUL_CALL",
            `effectful operation '${root}.${stmt.expr.callee.property}' is not allowed inside parallel for`,
            stmt.expr.callee.range,
          );
        }
        if (binding?.kind === "tool" && EFFECTFUL_TOOL_METHODS.has(stmt.expr.callee.property)) {
          this.error(
            "PARALLEL_FOR_EFFECTFUL_CALL",
            `effectful operation '${root}.${stmt.expr.callee.property}' is not allowed inside parallel for`,
            stmt.expr.callee.range,
          );
        }
        if (binding && !scope.isLocalToThisScope(root) && stmt.expr.callee.property === "add") {
          this.error(
            "PARALLEL_FOR_OUTER_MUTATION",
            `parallel for body cannot mutate outer variable '${root}'`,
            stmt.expr.callee.range,
          );
        }
      }
      this.checkStatement(stmt, scope);
    }
  }

  private checkIdentifier(name: string, range: SourceRange, scope: SemanticScope): void {
    if (!scope.resolve(name)) {
      this.error("UNKNOWN_IDENTIFIER", `Unknown identifier '${name}'`, range);
    }
  }

  private checkUseValue(expr: Expr, scope: SemanticScope): void {
    const root = this.rootIdentifier(expr);
    if (!root) {
      return;
    }
    const binding = scope.resolve(root.name);
    if (binding && NON_CONTEXT_BINDING_KINDS.has(binding.kind)) {
      this.error("INVALID_USE_RESOURCE", `Resource '${root.name}' cannot be used as prompt context`, root.range);
    }
  }

  private rootIdentifier(expr: Expr): { name: string; range: SourceRange } | undefined {
    switch (expr.kind) {
      case "IdentifierExpr":
        return { name: expr.name, range: expr.range };
      case "MemberExpr":
        return this.rootIdentifier(expr.object);
      case "IndexExpr":
        return this.rootIdentifier(expr.object);
      default:
        return undefined;
    }
  }

  private checkMember(expr: MemberExpr, scope: SemanticScope): void {
    this.checkExpression(expr.object, scope);
  }

  private checkCall(expr: CallExpr, scope: SemanticScope): void {
    this.checkCallable(expr.callee, scope);
    for (const arg of expr.args) {
      this.checkExpression(arg, scope);
    }
    this.checkCallArity(expr, scope);
  }

  private checkCallable(callee: Expr, scope: SemanticScope): void {
    if (callee.kind === "IdentifierExpr") {
      const binding = scope.resolve(callee.name);
      if (!binding) {
        this.error("UNKNOWN_FUNCTION", `Unknown function '${callee.name}'`, callee.range);
        return;
      }
      if (binding.kind !== "function" && binding.kind !== "agent") {
        this.error("NOT_CALLABLE", `'${callee.name}' is not an agent function or agent`, callee.range);
      }
      return;
    }

    if (callee.kind === "MemberExpr") {
      this.checkExpression(callee.object, scope);
      if (callee.object.kind === "IdentifierExpr") {
        const binding = scope.resolve(callee.object.name);
        if (binding?.kind === "memory" && !VALID_MEMORY_METHODS.has(callee.property)) {
          this.error(
            "UNKNOWN_MEMORY_METHOD",
            `Unknown memory method '${callee.object.name}.${callee.property}'`,
            callee.range,
          );
        }
      }
      return;
    }

    this.checkExpression(callee, scope);
    this.error("NOT_CALLABLE", "Only agent functions and member calls can be called in V0", callee.range);
  }

  private checkGenerate(expr: GenerateExpr, scope: SemanticScope): void {
    if (expr.options.input) {
      this.checkExpression(expr.options.input, scope);
    }
    this.checkGenerateInput(expr);
    if (expr.returnShape) {
      this.checkShapeObject(expr.returnShape);
    }
    this.checkGenerateConfig("model", expr, scope);
    this.checkGenerateConfig("role", expr, scope);
    this.checkGenerateConfig("description", expr, scope);
  }

  private checkGenerateInput(expr: GenerateExpr): void {
    let hasInput = false;
    const seen = new Set<string>();
    for (const property of expr.options.properties) {
      if (seen.has(property.key)) {
        this.error("DUPLICATE_GENERATE_OPTION", `Duplicate generate option '${property.key}'`, property.range);
      }
      seen.add(property.key);

      if (property.key === "input") {
        hasInput = true;
      } else if (property.key === "attempts") {
        const isPositiveInteger =
          property.value.kind === "NumberExpr" && Number.isInteger(property.value.value) && property.value.value > 0;
        if (!isPositiveInteger) {
          this.error("INVALID_GENERATE_ATTEMPTS", "generate attempts must be a positive integer", property.value.range);
        }
      } else if (property.key === "max_output") {
        if (!expr.options.maxOutput || expr.options.maxOutput.amount <= 0) {
          this.error(
            "INVALID_GENERATE_MAX_OUTPUT",
            "generate max_output must be a positive budget",
            property.value.range,
          );
        }
      } else if (property.key === "temperature") {
        if (property.value.kind !== "NumberExpr") {
          this.error("INVALID_GENERATE_TEMPERATURE", "generate temperature must be a number", property.value.range);
        }
      } else if (property.key === "think") {
        const validThinkString =
          property.value.kind === "StringExpr" && ["auto", "low", "medium", "high"].includes(property.value.value);
        if (property.value.kind !== "BooleanExpr" && !validThinkString) {
          this.error(
            "INVALID_GENERATE_THINK",
            "generate think must be a boolean or one of auto, low, medium, high",
            property.value.range,
          );
        }
      } else if (property.key === "strict") {
        if (property.value.kind !== "BooleanExpr") {
          this.error("INVALID_GENERATE_STRICT", "generate strict must be a boolean", property.value.range);
        }
      } else if (property.key === "debug") {
        if (property.value.kind !== "BooleanExpr") {
          this.error("INVALID_GENERATE_DEBUG", "generate debug must be a boolean", property.value.range);
        }
      } else {
        this.error("UNKNOWN_GENERATE_OPTION", `Unknown generate option '${property.key}'`, property.range);
      }
    }

    if (!hasInput) {
      this.error("INVALID_GENERATE_INPUT", "generate object argument requires an input field", expr.options.range);
    }
  }

  private checkGenerateConfig(key: ConfigKey, expr: GenerateExpr, scope: SemanticScope): void {
    if (!scope.hasConfig(key)) {
      this.error("MISSING_GENERATE_CONFIG", `generate requires ${key} in the current scope`, expr.range);
    }
  }

  private checkCallArity(expr: CallExpr, scope: SemanticScope): void {
    if (expr.callee.kind === "IdentifierExpr") {
      const binding = scope.resolve(expr.callee.name);
      if (binding?.kind === "function") {
        this.checkExpectedArity(binding, expr.args.length, expr.range);
      } else if (binding?.kind === "agent" && binding.agentName) {
        const fn = this.findAgentMainFunction(binding.agentName);
        if (!fn) {
          this.error("UNKNOWN_FUNCTION", `Agent '${binding.agentName}' has no callable main func`, expr.callee.range);
        } else {
          this.checkExpectedArity(functionBinding(binding.agentName, fn), expr.args.length, expr.range);
        }
      }
      return;
    }

    if (expr.callee.kind === "MemberExpr" && expr.callee.object.kind === "IdentifierExpr") {
      const binding = scope.resolve(expr.callee.object.name);
      if (binding?.kind === "agent" && binding.agentName) {
        const fn = this.findAgentFunction(binding.agentName, expr.callee.property);
        if (!fn) {
          this.error(
            "UNKNOWN_FUNCTION",
            `Unknown function '${binding.agentName}.${expr.callee.property}'`,
            expr.callee.range,
          );
        } else {
          this.checkExpectedArity(functionBinding(binding.agentName, fn), expr.args.length, expr.range);
        }
      } else if (binding?.kind === "memory") {
        const methodName = `${expr.callee.object.name}.${expr.callee.property}`;
        if (VALID_MEMORY_METHODS.has(expr.callee.property)) {
          if (expr.args.length !== 1) {
            this.error(
              "INVALID_ARGUMENT_COUNT",
              `Memory method '${methodName}' expects 1 argument(s), got ${expr.args.length}`,
              expr.range,
            );
          }
        } else {
          this.error("UNKNOWN_MEMORY_METHOD", `Unknown memory method '${methodName}'`, expr.callee.range);
        }
      }
    }
  }

  private checkExpectedArity(binding: Binding, actual: number, range: SourceRange): void {
    if (binding.arity === undefined || binding.arity === actual) {
      return;
    }
    const displayName =
      binding.agentName && binding.functionName ? `${binding.agentName}.${binding.functionName}` : "function";
    this.error(
      "INVALID_ARGUMENT_COUNT",
      `Function '${displayName}' expects ${binding.arity} argument(s), got ${actual}`,
      range,
    );
  }

  private findAgentFunction(agentName: string, functionName: string): FuncDecl | undefined {
    return this.agentDecls.get(agentName)?.functions.find((fn) => fn.name === functionName);
  }

  private findAgentMainFunction(agentName: string): FuncDecl | undefined {
    return this.agentDecls.get(agentName)?.functions.find((fn) => fn.isMain);
  }

  private checkShapeObject(shape: ShapeObjectExpr): void {
    const fields = new Set<string>();
    for (const field of shape.fields) {
      if (fields.has(field.name)) {
        this.error("DUPLICATE_SHAPE_FIELD", `Duplicate generate return field '${field.name}'`, field.range);
      }
      fields.add(field.name);
      this.checkShapeType(field.type);
    }
  }

  private checkShapeType(type: ShapeTypeExpr): void {
    if (type.kind === "ListShapeType") {
      this.checkListShapeType(type);
      return;
    }
    this.checkNamedShapeType(type);
  }

  private checkListShapeType(type: ListShapeType): void {
    this.checkShapeType(type.itemType);
  }

  private checkNamedShapeType(type: NamedShapeType): void {
    if (!SHAPE_TYPE_NAMES.has(type.name)) {
      this.error("UNKNOWN_SHAPE_TYPE", `Unsupported shape type '${type.name}'`, type.range);
    }
  }

  private error(code: string, message: string, range: SourceRange): void {
    this.diagnostics.push({ severity: "error", code, message, range });
  }
}

const IMPORTED_BINDING_KINDS = new Set<BindingKind>(["tool", "llm", "file", "agent", "memory"]);
const NON_CONTEXT_BINDING_KINDS = new Set<BindingKind>(["tool", "llm", "agent", "function", "memory"]);
const VALID_MEMORY_METHODS = new Set(["add", "query"]);
const EFFECTFUL_TOOL_METHODS = new Set(["write", "patch", "delete", "post", "put"]);
const RESERVED_CONTEXT_LABELS = new Set(["system", "assistant", "tool", "developer"]);

function functionBinding(agentName: string, fn: FuncDecl): Binding {
  return {
    kind: "function",
    range: fn.range,
    agentName,
    functionName: fn.name,
    arity: fn.params.length,
  };
}

function isImportedBinding(kind: BindingKind): boolean {
  return IMPORTED_BINDING_KINDS.has(kind);
}

function importResourceKindToBindingKind(resourceKind: string): BindingKind {
  if (IMPORTED_BINDING_KINDS.has(resourceKind as BindingKind)) {
    return resourceKind as BindingKind;
  }
  return "file";
}
