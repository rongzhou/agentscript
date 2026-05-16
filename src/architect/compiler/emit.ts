import type {
  AgentSpec,
  AgentSpecContext,
  AgentSpecGeneration,
  AgentSpecLocal,
  AgentSpecOutput,
  AgentSpecOutputField,
} from "../spec/types.js";

export function emitImports(spec: AgentSpec): string[] {
  const lines = [`import llm ${spec.model.import_name} from ${quote(spec.model.uri)}`];
  for (const tool of spec.tools) {
    lines.push(`import tool ${tool.import_name} from ${quote(tool.uri)}`);
  }
  return lines;
}

export function emitAgentStart(spec: AgentSpec): string[] {
  return [
    `main agent ${spec.agent.name} {`,
    `    model ${spec.model.import_name}`,
    `    role ${quote(spec.agent.role)}`,
    `    description ${quote(spec.agent.description)}`,
    "",
    "    main func(input {",
    ...Object.entries(spec.inputs).map(([name, input]) => `        ${name}: ${input.type}`),
    "    }) {",
  ];
}

export function emitAgentEnd(): string[] {
  return ["    }", "}"];
}

export function emitLocals(locals: AgentSpecLocal[]): string[] {
  const lines: string[] = [];
  locals.forEach((local, index) => {
    if (index > 0) lines.push("");
    lines.push(`        ${local.name} = ${local.source.tool}.${local.source.method}({`);
    lines.push(...emitArgs(local.source.args, 3, resolveArgExpr));
    lines.push("        })");
  });
  return lines;
}

export function emitModelContext(modelContext: AgentSpecContext[]): string[] {
  return modelContext.map((context) => {
    const budget = context.max ? ` max ${context.max}` : "";
    return `        use ${resolveContextSource(context.source)}${budget} as ${quote(context.label)}`;
  });
}

export function emitGenerateReturn(generation: AgentSpecGeneration, output: AgentSpecOutput): string[] {
  return [
    "        return generate({",
    ...emitGenerateOptions(generation, 3),
    "        }) -> {",
    ...emitContractFields(output.fields, 3),
    "        }",
  ];
}

export function emitGenerateAssignment(
  name: string,
  generation: AgentSpecGeneration,
  output: AgentSpecOutput,
): string[] {
  return [
    `            ${name} = generate({`,
    ...emitGenerateOptions(generation, 4),
    "            }) -> {",
    ...emitContractFields(output.fields, 4),
    "            }",
  ];
}

function emitGenerateOptions(generation: AgentSpecGeneration, indent: number): string[] {
  const pad = spaces(indent);
  const lines = [`${pad}input: ${quote(generation.input)}`];
  if (generation.max_output !== undefined) {
    lines[0] += ",";
    lines.push(`${pad}max_output: ${generation.max_output}`);
  }
  return lines;
}

function emitContractFields(fields: Record<string, AgentSpecOutputField>, indent: number): string[] {
  const pad = spaces(indent);
  return Object.entries(fields).map(([name, field]) => `${pad}${name}: ${field.type}`);
}

export function emitArgs(args: Record<string, string>, indent: number, resolver: (value: string) => string): string[] {
  const entries = Object.entries(args);
  const pad = spaces(indent);
  return entries.map(([name, value], index) => {
    const suffix = index === entries.length - 1 ? "" : ",";
    return `${pad}${name}: ${resolver(value)}${suffix}`;
  });
}

export function resolveArgExpr(value: string): string {
  if (value.startsWith("input.")) return value;
  if (value.startsWith("local.")) return value.slice("local.".length);
  return quote(value);
}

function resolveContextSource(value: string): string {
  if (value.startsWith("input.")) return value;
  if (value.startsWith("local.")) return value.slice("local.".length);
  return quote(value);
}

export function quote(value: string): string {
  return JSON.stringify(value);
}

function spaces(level: number): string {
  return "    ".repeat(level);
}
