import { stdin as inputStream, stdout as outputStream } from "node:process";
import { createInterface } from "node:readline/promises";
import { isBalancedAgentBuffer } from "./repl-buffer.js";
import { handleCommand } from "./repl-commands.js";
import { addAgentSource, createReplSession } from "./repl-session.js";

export interface ReplOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function runRepl(options: ReplOptions = {}): Promise<number> {
  const reader = createInterface({
    input: options.input ?? inputStream,
    output: options.output ?? outputStream,
    terminal: isTty(options.input ?? inputStream),
  });
  const session = createReplSession();

  try {
    console.log("AgentScript REPL");
    console.log("Paste one complete agent or use :help.");

    let buffer: string[] = [];
    while (true) {
      const line = await reader.question(buffer.length === 0 ? "> " : ". ");
      const trimmed = line.trim();

      if (buffer.length === 0 && trimmed.startsWith(":")) {
        const shouldContinue = await handleCommand(trimmed, session, reader);
        if (!shouldContinue) {
          return 0;
        }
        continue;
      }

      if (buffer.length === 0 && trimmed.length === 0) {
        continue;
      }

      buffer.push(line);
      if (!isBalancedAgentBuffer(buffer)) {
        continue;
      }

      const source = buffer.join("\n").trim();
      buffer = [];
      if (source.length === 0) {
        continue;
      }
      addAgentSource(session, source);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "readline was closed") {
      return 0;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    reader.close();
  }
}

function isTty(stream: NodeJS.ReadableStream): boolean {
  return "isTTY" in stream && stream.isTTY === true;
}
