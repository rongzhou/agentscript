import { SUPPORTED_PATTERNS } from "../spec/types.js";
import type { AgentSpecDraft } from "../spec/schema.js";
import { error, type SpecDiagnostic } from "./helpers.js";
import { patternOf } from "./helpers.js";

export function checkPattern(spec: AgentSpecDraft): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  const pattern = patternOf(spec);
  if (!SUPPORTED_PATTERNS.has(pattern)) {
    diagnostics.push(error("UNSUPPORTED_PATTERN", "/pattern", `Unsupported pattern '${pattern}'.`));
    return diagnostics;
  }
  if (pattern === "react" && !("react" in spec)) {
    diagnostics.push(error("MISSING_PATTERN_BLOCK", "/react", "pattern 'react' requires a react block."));
  }
  if (pattern === "linear" && "react" in spec) {
    diagnostics.push(error("UNEXPECTED_PATTERN_BLOCK", "/react", "linear specs must not include a react block."));
  }
  return diagnostics;
}
