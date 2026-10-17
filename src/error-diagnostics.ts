import { z } from "zod";

// Curated locations, never exception text, URL, selector, form value or stack.
// Historical report-v1 catalogue. Keep these exact codes and labels readable.
export const legacyDiagnosticCodes = {
  browser_runtime: { origin: "browser", location: "website / runtime" },
  browser_promise: { origin: "browser", location: "website / asynchronous runtime" },
  page_render: { origin: "browser", location: "website / page error boundary" },
  correction_prepare: { origin: "browser", location: "corrections / prepare unsent draft" },
  update_request: { origin: "browser", location: "update preview / run button" },
  update_history: { origin: "browser", location: "update preview / load recent runs" },
  update_export: { origin: "browser", location: "update preview / export comparison" },
  custodian_request: { origin: "browser", location: "source preview / private collection request" },
  server_render: { origin: "server", location: "website / server rendering" },
  server_route: { origin: "server", location: "website / route handler" },
  server_action: { origin: "server", location: "website / server action" },
  update_operation: { origin: "server", location: "update rehearsal / worker or archive" },
  update_worker: { origin: "worker", location: "update rehearsal / Python worker" },
  collector_worker: { origin: "worker", location: "collection / Python worker" },
} as const;
// Historical report-v2 catalogue. Do not add codes or change these labels.
export const diagnosticCodesV2 = {
  ...legacyDiagnosticCodes,
  copy_scope_observer: { origin: "server", location: "source preparation / observe copy scope" },
  parent_source_observer: { origin: "server", location: "source preparation / compare prepared parent source" },
  preparation_observer: { origin: "server", location: "source preparation / observe private readiness" },
  weekly_status_observer: { origin: "server", location: "update rehearsal / observe weekly status" },
} as const;
// Historical report-v3 catalogue. Do not add codes or change these labels.
export const diagnosticCodesV3 = {
  ...diagnosticCodesV2,
  saved_run_export: { origin: "browser", location: "editorial preview / download saved run" },
  weekly_assessment_export: { origin: "browser", location: "update rehearsal / download dated assessment" },
} as const;
// Historical report-v4 catalogue. Do not add codes or change these labels.
export const diagnosticCodesV4 = {
  ...diagnosticCodesV3,
  operator_audit_read: { origin: "server", location: "editorial audit / read recorded metadata" },
} as const;
// Historical report-v5 catalogue. Do not add codes or change these labels.
export const diagnosticCodesV5 = {
  ...diagnosticCodesV4,
  correction_review_observer: { origin: "server", location: "correction review / observe saved review" },
  supervised_review_observer: { origin: "server", location: "correction review / observe supervised saved review" },
} as const;
// Historical report-v6 catalogue. Keep original attribution readable.
export const diagnosticCodesV6 = {
  ...diagnosticCodesV5,
  public_issue_read: { origin: "server", location: "current issue / read checked publication" },
} as const;
// Historical report-v7 catalogue. Keep original attribution readable.
export const diagnosticCodesV7 = {
  ...diagnosticCodesV6,
  proposal_capture_write: { origin: "server", location: "private proposals / capture work-bound content" },
} as const;
export const fictionalCorrectionDiagnosticCodes = {
  fictional_correction_current: { origin: "browser", location: "fictional corrections / read current target" },
  fictional_correction_prepare: { origin: "browser", location: "fictional corrections / prepare fixed draft" },
  fictional_correction_submit: { origin: "browser", location: "fictional corrections / submit fixed request" },
  fictional_correction_queue: { origin: "browser", location: "fictional corrections / read review queue" },
  fictional_correction_detail: { origin: "browser", location: "fictional corrections / read report detail" },
  fictional_correction_review: { origin: "browser", location: "fictional corrections / record review transition" },
  fictional_correction_recover: { origin: "browser", location: "fictional corrections / recover recorded review" },
  fictional_correction_display: { origin: "browser", location: "fictional corrections / update exercise view" },
} as const;
export type FictionalCorrectionDiagnosticCode = keyof typeof fictionalCorrectionDiagnosticCodes;
// Historical report-v8 catalogue. Preserve all original locations and codes.
export const diagnosticCodesV8 = {
  ...diagnosticCodesV7,
  ...fictionalCorrectionDiagnosticCodes,
} as const;
export const diagnosticCodes = {
  ...diagnosticCodesV8,
  scope_draft_export: { origin: "browser", location: "editorial preview / download scope preparation" },
} as const;
export type DiagnosticCode = keyof typeof diagnosticCodes;
export const diagnosticIntentSchema = z.object({
  eventId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  code: z.enum(Object.keys(diagnosticCodes) as [DiagnosticCode, ...DiagnosticCode[]]),
}).strict();
export const diagnosticEventSchema = diagnosticIntentSchema.extend({
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime({ precision: 3 }),
  origin: z.enum(["browser", "server", "worker"]),
}).strict().refine(event => diagnosticCodes[event.code].origin === event.origin);
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;
export const DIAGNOSTIC_FILE_BYTES = 512;
export const DIAGNOSTIC_CAPACITY = 1_000;

export function makeDiagnosticEvent(code: DiagnosticCode, eventId: string, now = new Date()): DiagnosticEvent {
  return diagnosticEventSchema.parse({ schemaVersion: 1, eventId, code,
    occurredAt: now.toISOString(), origin: diagnosticCodes[code].origin });
}
