import { parseWeeklyRehearsalStatus } from "./weekly-rehearsal-status.ts";

// Export a dated fictional observation, without turning it into live evidence.
export function exportWeeklyRehearsal(input: unknown): { filename: string; body: string } {
  const status = parseWeeklyRehearsalStatus(input);
  if (status.state !== "observed") throw new Error("A verified fictional observation is required");
  return {
    filename: `terrafracta-weekly-rehearsal-${status.observation.windowKey}.json`,
    body: JSON.stringify({ schemaVersion: 1, artifactKind: "fictional_weekly_rehearsal_status",
      historicalObservation: true, observation: status.observation,
      limitation: "Dated local fictional assessment. No authenticated live run evidence, source collection, real schedule, alert or publication.",
    }, null, 2) + "\n",
  };
}
