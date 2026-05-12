import type { Budget, Expr } from "../ast/types.js";
import { RuntimeError } from "./errors.js";

export interface RuntimeUseOneOfCandidate {
  name: string;
  expr?: Expr;
  source?: string;
  budget?: Budget;
  selected: boolean;
}

export type UseOneOfSelectionReason = "trial" | "selected" | "first";

export interface UseOneOfSelection {
  candidate: RuntimeUseOneOfCandidate;
  reason: UseOneOfSelectionReason;
}

export function pickUseOneOfCandidate(
  candidates: RuntimeUseOneOfCandidate[],
  hint: string | undefined,
  siteId: string,
): UseOneOfSelection {
  if (hint) {
    const hinted = candidates.find((candidate) => candidate.name === hint);
    if (hinted) {
      return { candidate: hinted, reason: "trial" };
    }
    throw new RuntimeError(`Unknown use one of variant '${hint}' for site '${siteId}'`);
  }

  const selected = candidates.find((candidate) => candidate.selected);
  if (selected) {
    return { candidate: selected, reason: "selected" };
  }

  return { candidate: candidates[0]!, reason: "first" };
}
