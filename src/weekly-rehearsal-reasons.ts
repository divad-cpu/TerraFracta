import type { WeeklyRehearsalStatus } from "./weekly-rehearsal-status.ts";

type Reason = Extract<WeeklyRehearsalStatus, { state: "observed" }>["observation"]["reason"];
// Explain the recorded observation only; these labels do not perform an assessment.
export const weeklyRehearsalReasonMeanings = {
  history_incomplete: "The recorded history was incomplete or changed during inspection. No weekly coverage was established.",
  latest_receipt_ambiguous: "At least one rehearsal trigger's latest recorded execution time had more than one receipt. That outcome remained unclear.",
  not_due: "The example window was not yet due at the recorded observation.",
  within_grace_window: "The recorded observation was within the example window's rehearsal grace period.",
  window_invalid: "The example window could not be verified.",
  run_receipt_invalid: "A saved receipt could not support the example window.",
  run_not_completed: "The latest recorded weekly rehearsal did not complete.",
  due_source_coverage_incomplete: "The recorded weekly rehearsal did not cover the exact expected fictional source.",
  visibility_unverified: "The recorded rehearsal's visibility was unresolved.",
  scheduled_run_late: "A complete weekly rehearsal was recorded after the example deadline.",
  due_window_completed: "A complete weekly rehearsal was recorded within the example deadline.",
  scheduled_run_missing: "No completed weekly rehearsal supported this example window.",
  scheduled_run_missing_manual_catchup_complete: "A manual rehearsal covered the example source. The weekly trigger still had no completed rehearsal.",
  scheduled_run_missing_manual_catchup_incomplete: "The manual catch-up did not establish a completed, visible rehearsal covering the expected example source set.",
} as const satisfies Record<Reason, string>;
