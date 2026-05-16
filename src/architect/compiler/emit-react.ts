import type { ReactAgentSpec } from "../spec/types.js";
import {
  emitAgentEnd,
  emitAgentStart,
  emitArgs,
  emitGenerateAssignment,
  emitGenerateReturn,
  emitImports,
  emitLocals,
  emitModelContext,
  quote,
  resolveArgExpr,
} from "./emit.js";

export function emitReact(spec: ReactAgentSpec): string {
  const body: string[] = [];
  const locals = emitLocals(spec.locals);
  if (locals.length > 0) body.push(...locals, "");
  body.push(...emitModelContext(spec.model_context), "");
  body.push("        scratch = []");
  body.push(`        use scratch.summary max ${spec.react.scratch.max} as ${quote(spec.react.scratch.label)}`);
  body.push("        done = false");
  body.push("");
  body.push(`        loop until done max ${spec.react.max_iterations} {`);
  body.push(...emitGenerateAssignment("thought", spec.react.reason, spec.react.reason.output));
  body.push("");
  body.push(`            obs = ${spec.react.act.tool}.${spec.react.act.method}({`);
  body.push(...emitArgs(spec.react.act.args, 4, resolveActArgExpr));
  body.push("            })");
  body.push("            scratch.add(obs)");
  body.push(`            done = ${spec.react.stop_when}`);
  body.push("        }");
  body.push("");
  body.push(...emitGenerateReturn(spec.generation, spec.output));

  return [...emitImports(spec), "", ...emitAgentStart(spec), ...body, ...emitAgentEnd(), ""].join("\n");
}

function resolveActArgExpr(value: string): string {
  if (value.startsWith("thought.")) return value;
  return resolveArgExpr(value);
}
