import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RuntimeError } from "../../runtime/core/errors.js";
import { isObject } from "../../runtime/values/guards.js";
import type { JsonObject, RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import type { WorkspaceContext } from "../shared/workspace.js";
import { expectObject, readRequiredString } from "./shared.js";

const FILE_EFFECT_ACTIONS = new Set(["write", "patch"]);

export class FileToolProvider implements ToolProvider {
  constructor(private readonly workspace: WorkspaceContext) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (request.method === "undo") {
      return this.undoFileEffects(request.args[0]);
    }
    const args = expectObject(request.args[0], `File.${request.method}`);

    switch (request.method) {
      case "read":
        return {
          ok: true,
          content: readFileSync(
            this.workspace.resolveWorkspacePath(readRequiredString(args.path, "File.read.path")),
            "utf8",
          ),
        };
      case "list": {
        const path = this.workspace.resolveWorkspacePath(readRequiredString(args.path, "File.list.path"));
        return { ok: true, entries: readdirSync(path).map((entry: string) => entry) };
      }
      case "write":
        return this.writeFile(request.toolName, args);
      case "patch":
        return this.patchFile(request.toolName, args);
      default:
        throw new RuntimeError(
          `Unsupported file method '${request.method}'. Supported: read, list, write, patch, undo`,
        );
    }
  }

  private writeFile(toolName: string, args: Record<string, RuntimeValue>): RuntimeValue {
    const path = this.workspace.resolveWorkspacePath(readRequiredString(args.path, "File.write.path"));
    const relPath = this.workspace.workspaceRelativePath(path);
    const content = readRequiredString(args.content, "File.write.content");
    const existed = existsSync(path);
    const previous = existed ? readFileSync(path, "utf8") : null;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return fileEffectResult({
      id: `file-write:${relPath}`,
      tool: toolName,
      action: "write",
      path: relPath,
      undoable: true,
      existed,
      previous,
    });
  }

  private patchFile(toolName: string, args: Record<string, RuntimeValue>): RuntimeValue {
    const path = this.workspace.resolveWorkspacePath(readRequiredString(args.path, "File.patch.path"));
    const relPath = this.workspace.workspaceRelativePath(path);
    const search = readRequiredString(args.search, "File.patch.search");
    const replace = readRequiredString(args.replace, "File.patch.replace");
    const previous = readFileSync(path, "utf8");
    if (search.length === 0 || !previous.includes(search)) {
      throw new RuntimeError("File.patch search text not found");
    }
    writeFileSync(path, previous.replace(search, replace));
    return fileEffectResult({
      id: `file-patch:${relPath}`,
      tool: toolName,
      action: "patch",
      path: relPath,
      undoable: true,
      previous,
    });
  }

  private undoFileEffects(value: RuntimeValue): RuntimeValue {
    if (!Array.isArray(value)) {
      throw new RuntimeError("File.undo expects a list of effects");
    }
    for (const effect of value) {
      if (!isFileEffect(effect)) continue;
      const path = this.workspace.resolveWorkspacePath(effect.path);
      if (typeof effect.previous === "string") {
        writeFileSync(path, effect.previous);
      } else if (effect.existed === false && existsSync(path)) {
        rmSync(path);
      }
    }
    return { ok: true };
  }
}

function fileEffectResult(effect: JsonObject): JsonObject {
  return {
    ok: true,
    effects: [effect],
  };
}

function isFileEffect(value: RuntimeValue): value is JsonObject & { action: "write" | "patch"; path: string } {
  return (
    isObject(value) &&
    typeof value.action === "string" &&
    FILE_EFFECT_ACTIONS.has(value.action) &&
    typeof value.path === "string" &&
    typeof value.undoable === "boolean"
  );
}
