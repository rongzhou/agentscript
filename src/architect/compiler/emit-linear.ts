import type { LinearAgentSpec } from "../spec/types.js";
import { emitAgentEnd, emitAgentStart, emitGenerateReturn, emitImports, emitLocals, emitModelContext } from "./emit.js";

export function emitLinear(spec: LinearAgentSpec): string {
  const body: string[] = [];
  const locals = emitLocals(spec.locals);
  if (locals.length > 0) body.push(...locals, "");
  body.push(...emitModelContext(spec.model_context), "");
  body.push(...emitGenerateReturn(spec.generation, spec.output));

  return [...emitImports(spec), "", ...emitAgentStart(spec), ...body, ...emitAgentEnd(), ""].join("\n");
}
