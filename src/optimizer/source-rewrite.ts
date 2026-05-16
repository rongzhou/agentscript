import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { UseOneOfCandidate } from "../ast/types.js";
import { formatExpressionSource } from "../ast/format.js";
import { normalizeTargetPath } from "../language/site-id.js";
import type { VariantSiteMetadata } from "../language/variant-sites.js";
import type { JsonObject } from "../runtime/values/values.js";
import type { LoadedProgramGraph, LoadedSourceFile } from "../runtime/program/loader.js";

export interface RewriteResult {
  files: Map<string, string>;
  changedFiles: LoadedSourceFile[];
  edits: JsonObject[];
  diff: string;
}

export interface OutputTarget {
  path: string;
  display: string;
  multi: boolean;
}

export function rewriteGraph(
  graph: LoadedProgramGraph,
  sites: VariantSiteMetadata[],
  selection: Record<string, string>,
  mode: string,
  comment: string | undefined,
  workspaceRoot: string,
): RewriteResult {
  const byId = new Map(sites.map((site) => [site.siteId, site]));
  const fileEdits = new Map<string, Array<{ start: number; end: number; text: string }>>();
  const edits: JsonObject[] = [];

  for (const [siteId, variant] of Object.entries(selection)) {
    const site = byId.get(siteId);
    if (!site) continue;
    const filePath = site.sourcePath ?? graph.entryPath ?? "<memory>";
    const target = site.candidates.find((candidate) => candidate.name === variant)!;
    const current = site.candidates.find((candidate) => candidate.selected);
    if (current?.name === target.name) continue;

    const sourceFile = graph.files.find((file) => file.path === filePath) ?? graph.files[0]!;
    const patches =
      mode === "flatten"
        ? flattenSite(site, target.node, sourceFile.source, comment)
        : preserveSite(site, target.node, sourceFile.source, comment);
    if (patches.length === 0) continue;

    const list = fileEdits.get(filePath) ?? [];
    list.push(...patches);
    fileEdits.set(filePath, list);
    edits.push({
      site_id: siteId,
      file: normalizeTargetPath(filePath, workspaceRoot),
      label: site.label,
      from: current?.name ?? null,
      to: target.name,
    });
  }

  const files = new Map<string, string>();
  const changedFiles: LoadedSourceFile[] = [];
  for (const file of graph.files) {
    const patches = fileEdits.get(file.path);
    if (!patches || patches.length === 0) {
      files.set(file.path, file.source);
      continue;
    }
    files.set(file.path, applyTextEdits(file.source, patches));
    changedFiles.push(file);
  }

  return {
    files,
    changedFiles,
    edits,
    diff: changedFiles
      .map((file) => unifiedDiff(file.path, file.source, files.get(file.path) ?? file.source))
      .join("\n"),
  };
}

export function outputTarget(graph: LoadedProgramGraph, output: string | undefined, writeMode: string): OutputTarget {
  const multi = graph.files.length > 1;
  const entry = graph.entryPath ?? "target.as";
  if (writeMode === "preview") return { path: "", display: "", multi };
  if (output) return { path: resolve(output), display: output, multi };
  if (!multi) {
    const path = `${entry.replace(/\.as$/, "")}.optimized.as`;
    return { path, display: path, multi };
  }
  const dir = `${entry.replace(/\.as$/, "")}.optimized`;
  return { path: dir, display: dir, multi };
}

export function writeRewrite(
  rewrite: RewriteResult,
  output: OutputTarget,
  writeMode: string,
  workspaceRoot: string,
): string[] {
  const outputs: string[] = [];
  if (writeMode === "in_place") {
    for (const file of rewrite.changedFiles) {
      writeFileSync(file.path, rewrite.files.get(file.path) ?? file.source);
      outputs.push(normalizeTargetPath(file.path, workspaceRoot));
    }
    return outputs;
  }
  if (!output.multi) {
    const [, content] = rewrite.files.entries().next().value as [string, string];
    mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, content);
    return [normalizeTargetPath(output.path, workspaceRoot)];
  }
  const root = commonRoot([...rewrite.files.keys()]);
  for (const [filePath, content] of rewrite.files) {
    const outPath = join(output.path, relative(root, filePath));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content);
    outputs.push(normalizeTargetPath(outPath, workspaceRoot));
  }
  return outputs;
}

function preserveSite(
  site: VariantSiteMetadata,
  target: UseOneOfCandidate,
  source: string,
  comment: string | undefined,
): Array<{ start: number; end: number; text: string }> {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const current = site.candidates.find((candidate) => candidate.selected)?.node;
  if (current) {
    edits.push(deleteSelectedEdit(current, source));
  }
  edits.push({ start: target.range.end.offset, end: target.range.end.offset, text: " selected" });
  if (comment) {
    const lineStart = source.lastIndexOf("\n", target.range.start.offset - 1) + 1;
    const indent = lineIndent(source, target.range.start.offset);
    edits.push({ start: lineStart, end: lineStart, text: `${indent}// ${comment}\n` });
  }
  return edits;
}

function deleteSelectedEdit(
  candidate: UseOneOfCandidate,
  source: string,
): { start: number; end: number; text: string } {
  const slice = source.slice(candidate.range.start.offset, candidate.range.end.offset);
  const match = /\s+selected\s*$/.exec(slice);
  if (!match) {
    return { start: candidate.range.end.offset, end: candidate.range.end.offset, text: "" };
  }
  const start = candidate.range.start.offset + match.index;
  return { start, end: candidate.range.end.offset, text: "" };
}

function flattenSite(
  site: VariantSiteMetadata,
  target: UseOneOfCandidate,
  source: string,
  comment: string | undefined,
): Array<{ start: number; end: number; text: string }> {
  const lineStart = source.lastIndexOf("\n", site.node.range.start.offset - 1) + 1;
  const prefix = comment ? `// ${comment}\n` : "";
  if (!target.value) {
    const end = source.indexOf("\n", site.node.range.end.offset);
    return [{ start: lineStart, end: end >= 0 ? end + 1 : site.node.range.end.offset, text: "" }];
  }
  const budget = target.budget ? ` max ${target.budget.amount}${target.budget.unit ?? ""}` : "";
  return [
    {
      start: site.node.range.start.offset,
      end: site.node.range.end.offset,
      text: `${prefix}use ${formatExpressionSource(target.value)}${budget} as ${site.label}`,
    },
  ];
}

function applyTextEdits(source: string, edits: Array<{ start: number; end: number; text: string }>): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  }
  return result;
}

function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, offset));
  return match?.[0] ?? "";
}

function unifiedDiff(path: string, oldSource: string, newSource: string): string {
  if (oldSource === newSource) return "";
  const oldLines = oldSource.split("\n");
  const newLines = newSource.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start += 1;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const context = 1;
  const oldHunkStart = Math.max(0, start - context);
  const newHunkStart = Math.max(0, start - context);
  const oldHunkEnd = Math.min(oldLines.length - 1, oldEnd + context);
  const newHunkEnd = Math.min(newLines.length - 1, newEnd + context);
  const oldCount = oldHunkEnd >= oldHunkStart ? oldHunkEnd - oldHunkStart + 1 : 0;
  const newCount = newHunkEnd >= newHunkStart ? newHunkEnd - newHunkStart + 1 : 0;
  const lines = [
    `--- ${path}`,
    `+++ ${path}`,
    `@@ -${oldHunkStart + 1},${oldCount} +${newHunkStart + 1},${newCount} @@`,
  ];

  for (let index = oldHunkStart; index < start; index += 1) {
    lines.push(` ${oldLines[index] ?? ""}`);
  }
  for (let index = start; index <= oldEnd; index += 1) {
    lines.push(`-${oldLines[index] ?? ""}`);
  }
  for (let index = start; index <= newEnd; index += 1) {
    lines.push(`+${newLines[index] ?? ""}`);
  }
  for (let index = oldEnd + 1; index <= oldHunkEnd; index += 1) {
    lines.push(` ${oldLines[index] ?? ""}`);
  }

  return lines.join("\n");
}

function commonRoot(paths: string[]): string {
  if (paths.length === 0) return process.cwd();
  let root = dirname(paths[0]!);
  while (paths.some((path) => !path.startsWith(root))) {
    const parent = dirname(root);
    if (parent === root) break;
    root = parent;
  }
  return root;
}
