import { parse } from "./parser/parser.js";
import { ProtocolLlmProvider } from "./providers/llm/protocol.js";
import { createDefaultMemoryProvider } from "./providers/memory/host.js";
import { createDefaultToolProvider } from "./providers/tools/host.js";
import { RuntimeError } from "./runtime/core/errors.js";
import { executeAgent } from "./runtime/core/interpreter.js";
import { loadProgram, loadProgramSource } from "./runtime/program/loader.js";
import { formatTrace } from "./runtime/trace/trace.js";
import { analyze, assertSemanticallyValid } from "./semantic/analyzer.js";
import { formatSemanticDiagnostics, SemanticError } from "./semantic/diagnostics.js";

export {
  ProtocolLlmProvider,
  RuntimeError,
  SemanticError,
  analyze,
  assertSemanticallyValid,
  createDefaultMemoryProvider,
  createDefaultToolProvider,
  executeAgent,
  formatSemanticDiagnostics,
  formatTrace,
  loadProgram,
  loadProgramSource,
  parse,
};

export type { ExecuteOptions, ExecuteResult } from "./runtime/core/interpreter.js";
export type { JsonObject, JsonValue, RuntimeValue } from "./runtime/values/values.js";
export type { LlmProvider, MemoryProvider, ToolProvider } from "./runtime/values/providers.js";
export type { TraceEvent } from "./runtime/trace/trace.js";
