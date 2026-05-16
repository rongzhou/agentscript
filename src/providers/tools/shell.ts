import { readFileSync } from "node:fs";
import { RuntimeError } from "../../runtime/core/errors.js";
import type { JsonObject, RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import type { WorkspaceContext } from "../shared/workspace.js";
import {
  DEFAULT_MAX_RESULTS,
  expectObject,
  globMatcher,
  readOptionalString,
  readPositiveInteger,
  readRequiredString,
  toolUriTarget,
} from "./shared.js";

const FORBIDDEN_SHELL_TOOLS = new Set(["sh", "bash", "zsh", "fish"]);
const SUPPORTED_SHELL_COMMANDS = new Set(["find", "grep", "read-range"]);
const MAX_GREP_FILE_BYTES = 1024 * 1024;

export class ShellToolProvider implements ToolProvider {
  constructor(private readonly workspace: WorkspaceContext) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const command = toolUriTarget(request.uri);
    if (FORBIDDEN_SHELL_TOOLS.has(command)) {
      throw new RuntimeError(`Forbidden shell tool '${command}'`);
    }
    switch (command) {
      case "find":
        return this.runFind(request.args[0]);
      case "grep":
        return this.runGrep(request.args[0]);
      case "read-range":
        return this.runReadRange(request.args[0]);
      default:
        throw new RuntimeError(
          `Unsupported shell tool '${command}'. Supported: ${[...SUPPORTED_SHELL_COMMANDS].join(", ")}`,
        );
    }
  }

  private runFind(value: RuntimeValue): RuntimeValue {
    const args = expectObject(value, "Find.run");
    const root = this.workspace.resolveWorkspacePath(readRequiredString(args.path, "Find.run.path"));
    const name = readOptionalString(args.name);
    const type = readOptionalString(args.type);
    const max = readPositiveInteger(args.max, DEFAULT_MAX_RESULTS);
    const matcher = name ? globMatcher(name) : undefined;
    const results: string[] = [];

    this.workspace.visitWorkspaceTree(root, (_path, relativePath, stat) => {
      const kind = stat.isDirectory() ? "dir" : "file";
      if ((!type || type === kind) && (!matcher || matcher(relativePath))) {
        results.push(relativePath);
      }
      return results.length < max;
    });
    return { ok: true, files: results };
  }

  private runGrep(value: RuntimeValue): RuntimeValue {
    const args = expectObject(value, "Grep.run");
    const root = this.workspace.resolveWorkspacePath(readRequiredString(args.path, "Grep.run.path"));
    const pattern = readRequiredString(args.pattern, "Grep.run.pattern");
    const include = readOptionalString(args.include);
    const max = readPositiveInteger(args.max, DEFAULT_MAX_RESULTS);
    const matcher = include ? globMatcher(include) : undefined;
    const matches: JsonObject[] = [];

    this.workspace.visitWorkspaceTree(root, (path, relativePath, stat) => {
      if (stat.isDirectory()) return true;
      if (matcher && !matcher(relativePath)) return true;
      if (stat.size > MAX_GREP_FILE_BYTES) return true;
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (line.includes(pattern)) {
          matches.push({ path: relativePath, line: index + 1, text: line });
          if (matches.length >= max) return false;
        }
      }
      return true;
    });
    return { ok: true, matches };
  }

  private runReadRange(value: RuntimeValue): RuntimeValue {
    const args = expectObject(value, "ReadRange.run");
    const path = this.workspace.resolveWorkspacePath(readRequiredString(args.path, "ReadRange.run.path"));
    const start = readPositiveInteger(args.start, 1);
    const max = readPositiveInteger(args.max, DEFAULT_MAX_RESULTS);
    const lines = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .slice(start - 1, start - 1 + max);
    return { ok: true, text: lines.join("\n"), start, end: start + lines.length - 1 };
  }
}
