import { readFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import type { Program } from "../ast/types.js";
import type { BindingKind } from "../language/bindings.js";
import { FILE_SCHEME, schemePrefix } from "../language/schemes.js";
import { RuntimeError } from "./errors.js";
import type { RuntimeValue } from "./types.js";

export interface RuntimeImportBinding {
  name: string;
  kind: Extract<BindingKind, "tool" | "llm" | "file" | "memory">;
  value: RuntimeValue;
}

export function createRuntimeImportBindings(program: Program, sourceDir: string): RuntimeImportBinding[] {
  return program.imports.map((imported) => {
    switch (imported.resourceKind) {
      case "tool":
        return {
          name: imported.name,
          kind: "tool",
          value: { __agentScriptResource: "tool", name: imported.name, uri: imported.uri },
        };
      case "llm":
        return {
          name: imported.name,
          kind: "llm",
          value: { __agentScriptResource: "llm", name: imported.name, uri: imported.uri },
        };
      case "file":
        return {
          name: imported.name,
          kind: "file",
          value: loadImportedFile(imported.uri, sourceDir),
        };
      case "memory":
        return {
          name: imported.name,
          kind: "memory",
          value: { __agentScriptResource: "memory", name: imported.name, uri: imported.uri },
        };
      case "agent":
        throw new RuntimeError("Agent imports should be resolved before runtime import binding", imported.range);
    }
  });
}

function loadImportedFile(uri: string, sourceDir: string): RuntimeValue {
  const path = resolveImportPath(uri, sourceDir);
  const content = readFileSync(path, "utf8");
  if (extname(path).toLowerCase() === ".json") {
    return JSON.parse(content) as RuntimeValue;
  }
  return content;
}

function resolveImportPath(uri: string, sourceDir: string): string {
  if (uri.startsWith(schemePrefix(FILE_SCHEME))) {
    return new URL(uri).pathname;
  }
  if (isAbsolute(uri)) {
    return uri;
  }
  return resolve(sourceDir, uri);
}
