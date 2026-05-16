import { stdin as inputStream, stdout as outputStream } from "node:process";
import { createInterface } from "node:readline/promises";
import { handleCommand } from "./repl-commands.js";
import { addAgentSource, createReplSession, terminalReplPrinter, type ReplPrinter } from "./repl-session.js";

export interface ReplOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  printer?: ReplPrinter;
}

export async function runRepl(options: ReplOptions = {}): Promise<number> {
  const reader = createInterface({
    input: options.input ?? inputStream,
    output: options.output ?? outputStream,
    terminal: isTty(options.input ?? inputStream),
  });
  const session = createReplSession();
  const printer = options.printer ?? terminalReplPrinter;

  try {
    printer.log("AgentScript REPL");
    printer.log("Paste one complete agent or use :help.");

    let buffer: string[] = [];
    while (true) {
      const line = await reader.question(buffer.length === 0 ? "> " : ". ");
      const trimmed = line.trim();

      if (buffer.length === 0 && trimmed.startsWith(":")) {
        const shouldContinue = await handleCommand(trimmed, session, reader, printer);
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
      addAgentSource(session, source, printer);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "readline was closed") {
      return 0;
    }
    printer.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    reader.close();
  }
}

function isTty(stream: NodeJS.ReadableStream): boolean {
  return "isTTY" in stream && stream.isTTY === true;
}

const AGENT_PATTERN = /^\s*(?:main\s+)?agent\b/;

function isBalancedAgentBuffer(lines: string[]): boolean {
  let depth = 0;
  let sawAgent = false;
  for (const line of lines) {
    if (AGENT_PATTERN.test(line)) {
      sawAgent = true;
    }
    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
    }
  }
  return sawAgent && depth === 0;
}
