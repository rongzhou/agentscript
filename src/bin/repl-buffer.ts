const AGENT_PATTERN = /^\s*(?:main\s+)?agent\b/;

export function isBalancedAgentBuffer(lines: string[]): boolean {
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
