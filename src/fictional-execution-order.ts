import type { FictionalUpdateResult } from "./fictional-update-result.ts";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

// Equivalent validated execution instants retain their separate UUID display tie.
export function compareFictionalExecutionNewestFirst(left: Pick<FictionalUpdateResult, "execution">, right: Pick<FictionalUpdateResult, "execution">): number {
  const order = compareRecordedInstants(left.execution.executedAt, right.execution.executedAt);
  return order === 0 ? right.execution.id.localeCompare(left.execution.id) : -order;
}
