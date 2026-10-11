import type { WeeklyRehearsalStatus } from "./weekly-rehearsal-status.ts";

type Observation = Extract<WeeklyRehearsalStatus, { state: "observed" }>["observation"];
// Both callers have already admitted the complete closed observation.
export function weeklyRehearsalTimingFields(observation: Observation) {
  return [
    { label: "Recorded example window", value: observation.windowKey, utc: false },
    { label: "Recorded observation (UTC)", value: observation.observedAt, utc: true },
    { label: "Recorded example due time (UTC)", value: observation.dueAt, utc: true },
    { label: "Example grace period", value: `${observation.graceMinutes} minutes, a fixed fictional rehearsal parameter`, utc: false },
  ] as const;
}
