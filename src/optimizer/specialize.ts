import { RuntimeError } from "../runtime/core/errors.js";
import { sanitizeForJson } from "../runtime/values/json.js";
import type { RuntimeValue } from "../runtime/values/values.js";
import type { ToolCallRequest } from "../runtime/values/providers.js";
import { expectRuntimeObject, readOptionalString, readRequiredString } from "../providers/tools/shared.js";
import type { OptimizerToolContext } from "./context.js";
import { collectGraphSites, normalizePath, readTargetGraph, semanticErrors } from "./graph.js";
import { readSelection, validateSelection } from "./selection.js";
import { snapshotGraph } from "./snapshot.js";
import { outputTarget, rewriteGraph, writeRewrite } from "./source-rewrite.js";

export function specializeOptimizer(request: ToolCallRequest, ctx: OptimizerToolContext): RuntimeValue {
  const args = expectRuntimeObject(request.args[0], "Optimizer.specialize");
  const target = readRequiredString(args.target, "target");
  const graph = readTargetGraph(target);
  const expectedSnapshot = readOptionalString(args.snapshot_id);
  const actualSnapshot = snapshotGraph(graph, ctx);
  if (expectedSnapshot && expectedSnapshot !== actualSnapshot) {
    return { ok: false, code: "snapshot_mismatch", expected: expectedSnapshot, actual: actualSnapshot };
  }
  const diagnostics = semanticErrors(graph);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      code: "semantic_error",
      target: normalizePath(graph.entryPath, ctx),
      diagnostics: sanitizeForJson(diagnostics),
    };
  }
  const sites = collectGraphSites(graph, ctx);
  const selection = readSelection(args.selection);
  const selectionError = validateSelection(selection, sites);
  if (selectionError) return selectionError;
  const fillMissing = readOptionalString(args.fill_missing) ?? "source_default";
  if (fillMissing !== "source_default" && fillMissing !== "require") {
    throw new RuntimeError("fill_missing must be 'source_default' or 'require'");
  }
  if (fillMissing === "require") {
    const missing = sites.map((site) => site.siteId).filter((siteId) => !(siteId in selection));
    if (missing.length > 0) return { ok: false, code: "incomplete_selection", missing_sites: missing };
  }
  const mode = readOptionalString(args.mode) ?? "structure-preserving";
  if (mode !== "structure-preserving" && mode !== "flatten") {
    throw new RuntimeError("mode must be 'structure-preserving' or 'flatten'");
  }
  const writeMode = readOptionalString(args.write) ?? "copy";
  if (writeMode !== "preview" && writeMode !== "copy" && writeMode !== "in_place") {
    throw new RuntimeError("write must be 'preview', 'copy', or 'in_place'");
  }

  const rewrite = rewriteGraph(graph, sites, selection, mode, readOptionalString(args.comment), ctx.workspaceRoot);
  const output = outputTarget(graph, readOptionalString(args.output), writeMode);
  const changed = rewrite.edits.length > 0;
  const outputs = !changed
    ? []
    : writeMode === "preview"
      ? rewrite.changedFiles.map((file) => normalizePath(file.path, ctx))
      : writeRewrite(rewrite, output, writeMode, ctx.workspaceRoot);
  return {
    ok: true,
    changed,
    output: !changed || writeMode === "preview" ? null : output.display,
    outputs,
    diff: rewrite.diff,
    edits: rewrite.edits,
    snapshot_id: actualSnapshot,
  };
}
