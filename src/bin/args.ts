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
  mock: boolean;
  parse: boolean;
  quiet: boolean;
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
        {
          const value = readOptionalOptionValue(argv, index + 1);
          if (!value) {
            options.tracePretty = true;
          } else {
            index += 1;
            options.traceFile = value;
          }
        }
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option '${arg}'`);
        }
        positional.push(arg);
    }
  }

  options.file = positional[0];
  if (positional.length > 1) {
    throw new Error("Unexpected positional argument. Use --input to pass input JSON.");
  }
  if (options.quiet && (options.verbose || options.tracePretty)) {
    throw new Error("Use either --quiet or verbose trace output, not both");
  }
  return options;
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
      "  agentscript <file.as> --concurrency 4",
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

function readOptionalOptionValue(args: string[], index: number): string | undefined {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}
