import { z } from "zod";

const schema = z.strictObject({ check: z.enum(["", "not_recorded", "failed", "coverage_unknown", "incomplete", "complete_changed", "complete_unchanged"]),
  permission: z.enum(["", "allowed", "denied", "unresolved"]) });
export type SourceMonitoringFilter = z.infer<typeof schema>;

// Presentation only: no source/provider selection, collection, rights change,
// fresh observation or aggregate quality/attention policy is introduced.
export function sourceMonitoringFilter(input: unknown): SourceMonitoringFilter | null {
  try { return schema.parse(input); } catch { return null; }
}
