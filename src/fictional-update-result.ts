import { z } from "zod";
import { updateRunReportSchema } from "./update-run-report.ts";

const scenarioSchema = z.enum(["standard", "missing_source", "invalid_citation", "revised_value"]);
export type FictionalUpdateScenario = z.infer<typeof scenarioSchema>;

export const fictionalUpdateResultSchema = z.strictObject({
  execution: z.strictObject({
    id: z.uuid(),
    kind: z.literal("local_fictional"),
    scenario: scenarioSchema,
    executedAt: z.iso.datetime(),
    durationMs: z.number().int().min(0).max(20_000),
  }),
  report: updateRunReportSchema,
}).superRefine(({ execution, report }, context) => {
  if (report.reportKind !== "fictional_rehearsal" || report.mode !== "shadow" || report.publicChanges !== 0) {
    context.addIssue({ code: "custom", message: "Local rehearsal returned a non-fictional result" });
  }
  const held = report.items.filter((item) => item.outcome === "held").length;
  const invalid = report.items.filter((item) => item.source === null && !item.sourceBindingValid).length;
  const matchesScenario = report.dueSourceKeys.length === 1 && (
    (["standard", "revised_value"].includes(execution.scenario) && report.state === "completed" &&
      report.items.length === 4 && held === 2 && invalid === 0 &&
      report.coveredSourceKeys.length === 1 && report.fictionalCandidate !== null &&
      report.fictionalCandidate.observation.value === (execution.scenario === "revised_value" ? "28.1" : "27.4") &&
      report.fictionalCandidate.decision.sourceVersionId === (execution.scenario === "revised_value"
        ? "55555555-5555-4555-8555-555555555555" : "22222222-2222-4222-8222-222222222222")) ||
    (execution.scenario === "missing_source" && report.state === "partial" &&
      report.items.length === 0 && report.coveredSourceKeys.length === 0 &&
      report.fictionalCandidate === null) ||
    (execution.scenario === "invalid_citation" && report.state === "partial" &&
      report.items.length === 4 && held === 3 && invalid === 1 &&
      report.coveredSourceKeys.length === 0 && report.fictionalCandidate === null)
  );
  if (!matchesScenario) {
    context.addIssue({ code: "custom", message: "Local result differs from the selected fixed example" });
  }
});

export type FictionalUpdateResult = z.infer<typeof fictionalUpdateResultSchema>;

export function parseFictionalUpdateResult(input: unknown): FictionalUpdateResult {
  return fictionalUpdateResultSchema.parse(input);
}
