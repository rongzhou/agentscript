export interface CliOptions {
  agentName?: string;
  check: boolean;
  concurrency?: number;
  dryRun: boolean;
  file?: string;
  functionName?: string;
  help: boolean;
  input?: string;
  inputFile?: string;
  maxLlmCalls?: number;
  maxSeconds?: number;
  maxTrials?: number;
  mock: boolean;
  optimizerArgs: Record<string, unknown>;
  parse: boolean;
  quiet: boolean;
  runDir?: string;
  targetFile?: string;
  traceLevel?: "summary" | "full" | "none";
  traceFile?: string;
  tracePretty: boolean;
  verbose: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    check: false,
    dryRun: false,
    help: false,
    mock: false,
    optimizerArgs: {},
    parse: false,
    quiet: false,
    tracePretty: false,
    verbose: false,
    version: false,
  };

  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--agent":
        options.agentName = readOptionValue(argv, ++index, arg);
        break;
      case "--function":
        options.functionName = readOptionValue(argv, ++index, arg);
        break;
      case "--input":
        options.input = readOptionValue(argv, ++index, arg);
        break;
      case "--input-file":
        options.inputFile = readOptionValue(argv, ++index, arg);
        break;
      case "--concurrency":
        options.concurrency = readPositiveIntegerOption(argv, ++index, arg);
        break;
      case "--max-trials":
        options.maxTrials = readNonNegativeIntegerOption(argv, ++index, arg);
        break;
      case "--max-llm-calls":
        options.maxLlmCalls = readNonNegativeIntegerOption(argv, ++index, arg);
        break;
      case "--max-seconds":
        options.maxSeconds = readNonNegativeIntegerOption(argv, ++index, arg);
        break;
      case "--run-dir":
        options.runDir = readOptionValue(argv, ++index, arg);
        break;
      case "--trace-level":
        options.traceLevel = readTraceLevelOption(argv, ++index, arg);
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--parse":
        options.parse = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--mock":
        options.mock = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      case "--trace":
        options.tracePretty = true;
        break;
      case "--trace-file":
        options.traceFile = readOptionValue(argv, ++index, arg);
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        if (arg.startsWith("--")) {
          const equalsIndex = arg.indexOf("=");
          const rawKey = equalsIndex >= 0 ? arg.slice(2, equalsIndex) : arg.slice(2);
          const key = rawKey.replace(/-/g, "_");
          if (!key) throw new Error(`Unknown option '${arg}'`);
          if (key.startsWith("no_")) {
            options.optimizerArgs[key.slice(3)] = false;
          } else if (equalsIndex >= 0) {
            options.optimizerArgs[key] = parseOptimizerValue(arg.slice(equalsIndex + 1));
          } else if (argv[index + 1] && !argv[index + 1]!.startsWith("--")) {
            options.optimizerArgs[key] = parseOptimizerValue(argv[++index]!);
          } else {
            options.optimizerArgs[key] = true;
          }
          break;
        }
        positional.push(arg);
    }
  }

  options.file = positional[0];
  if (positional.length > 1 && positional[1]!.endsWith(".as")) {
    options.targetFile = positional[1];
  } else if (positional.length > 1) {
    throw new Error("Unexpected positional argument. Use --input to pass input JSON.");
  }
  if (!options.targetFile && Object.keys(options.optimizerArgs).length > 0) {
    const option = Object.keys(options.optimizerArgs)[0]!.replace(/_/g, "-");
    throw new Error(`Unknown option '--${option}'`);
  }
  if (options.quiet && (options.verbose || options.tracePretty)) {
    throw new Error("Use either --quiet or verbose trace output, not both");
  }
  return options;
}

function parseOptimizerValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function printUsage(write: (message: string) => void): void {
  write(
    [
      "Usage:",
      '  agentscript <file.as> --input \'{"question":"..."}\'',
      "  agentscript <file.as>",
      "  agentscript <file.as> --mock",
      "  agentscript <file.as> --dry-run",
      "  agentscript <file.as> --trace",
      "  agentscript <file.as> --trace-file trace.json",
      "  agentscript <file.as> --concurrency 4",
      "  agentscript <optimizer.as> <target.as> --mock --max-trials 10",
      "  agentscript <file.as> --input-file input.json --agent AgentName",
      "  agentscript <file.as> --input '{}' --quiet",
      "  agentscript <file.as> --check",
      "  agentscript <file.as> --parse",
      "  agentscript",
    ].join("\n"),
  );
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Expected value after ${option}`);
  }
  return value;
}

function readPositiveIntegerOption(args: string[], index: number, option: string): number {
  const raw = readOptionValue(args, index, option);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || String(value) !== raw) {
    throw new Error(`${option} must be a positive integer`);
  }
  return value;
}

function readNonNegativeIntegerOption(args: string[], index: number, option: string): number {
  const raw = readOptionValue(args, index, option);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || String(value) !== raw) {
    throw new Error(`${option} must be a non-negative integer`);
  }
  return value;
}

function readTraceLevelOption(args: string[], index: number, option: string): "summary" | "full" | "none" {
  const value = readOptionValue(args, index, option);
  if (value === "summary" || value === "full" || value === "none") return value;
  throw new Error(`${option} must be summary, full, or none`);
}
