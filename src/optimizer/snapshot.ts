import { createHash } from "node:crypto";
import type { LoadedProgramGraph } from "../runtime/loader.js";
import type { OptimizerToolContext } from "./context.js";
import { normalizePath } from "./graph.js";

export function snapshotGraph(graph: LoadedProgramGraph, ctx: OptimizerToolContext): string {
  const hash = createHash("sha256");
  for (const file of [...graph.files].sort((a, b) =>
    normalizePath(a.path, ctx).localeCompare(normalizePath(b.path, ctx)),
  )) {
    hash.update(normalizePath(file.path, ctx));
    hash.update("\0");
    hash.update(normalizeSource(file.source));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function normalizeSource(source: string): string {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC");
}
