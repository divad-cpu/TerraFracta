import { fictionalUpdateResultSchema } from "./fictional-update-result.ts";
import { compareFictionalObservations } from "./fictional-observation-comparison.ts";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

// Only checked saved rehearsals. Execution order does not establish source
// chronology: the existing observation comparator also checks retrieval order.
export function compareFictionalSavedRuns(earlierInput: unknown, laterInput: unknown) {
  try {
    // Schema refusal and exceptions while reading unknown inputs both withhold
    // the comparison. Neither may expose an input or exception to the view.
    const earlier = fictionalUpdateResultSchema.safeParse(earlierInput);
    const later = fictionalUpdateResultSchema.safeParse(laterInput);
    if (!earlier.success || !later.success) return { kind: "held", reason: "unavailable" } as const;
    if (earlier.data.execution.id === later.data.execution.id ||
        compareRecordedInstants(earlier.data.execution.executedAt, later.data.execution.executedAt) >= 0) {
      return { kind: "held", reason: "execution_order" } as const;
    }
    const before = earlier.data.report.fictionalCandidate;
    const after = later.data.report.fictionalCandidate;
    if (!before || !after) return { kind: "held", reason: "missing_observation" } as const;
    if (earlier.data.report.scope !== later.data.report.scope ||
        compareFictionalObservations(before, after).kind === "held") {
      return { kind: "held", reason: "observation_mismatch" } as const;
    }
    return { kind: "comparable", earlier: earlier.data, later: later.data, before, after } as const;
  } catch {
    return { kind: "held", reason: "unavailable" } as const;
  }
}
