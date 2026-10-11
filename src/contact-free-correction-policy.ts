import { z } from "zod";

// Accepted development direction only. These limits neither install retention
// nor authorize real reports, database access, an endpoint or a publication.
export const contactFreeCorrectionPolicy = Object.freeze({
  version: "contact-free-pilot-v1",
  bodyBytes: 16 * 1024,
  concurrentAdmissions: 2,
  attemptsPerAddress: 5,
  addressWindowMs: 15 * 60 * 1000,
  acceptedPerHour: 60,
  globalWindowMs: 60 * 60 * 1000,
  openReports: 200,
  payloadLifetimeMs: 90 * 24 * 60 * 60 * 1000,
  closedPayloadLifetimeMs: 30 * 24 * 60 * 60 * 1000,
  recordLifetimeMs: 180 * 24 * 60 * 60 * 1000,
  backupLifetimeMs: 7 * 24 * 60 * 60 * 1000,
  addressIdentifierLifetimeMs: 30 * 60 * 1000,
});

const instant = z.number().int().nonnegative().safe();
const receiptInstant = instant.max(Number.MAX_SAFE_INTEGER - contactFreeCorrectionPolicy.recordLifetimeMs);
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const lifecycle = z.strictObject({
  schemaVersion: z.literal(1), reportId: id, receivedAtMs: receiptInstant,
  closedAtMs: receiptInstant.nullable(), erasedAtMs: instant.nullable(),
  eraseReason: z.enum(["reporter_request", "sensitive_material", "expired"]).nullable(),
}).superRefine((value, context) => {
  if (value.closedAtMs !== null && value.closedAtMs < value.receivedAtMs ||
      value.erasedAtMs !== null && value.erasedAtMs < value.receivedAtMs ||
      (value.erasedAtMs === null) !== (value.eraseReason === null)) {
    context.addIssue({ code: "custom", message: "Correction lifecycle differs" });
  }
  const ordinaryExpiry = Math.min(value.receivedAtMs + contactFreeCorrectionPolicy.payloadLifetimeMs,
    value.closedAtMs === null ? Infinity : value.closedAtMs + contactFreeCorrectionPolicy.closedPayloadLifetimeMs);
  if (value.eraseReason === "expired" && value.erasedAtMs! < ordinaryExpiry) {
    context.addIssue({ code: "custom", message: "Correction erasure time differs" });
  }
});
export type ContactFreeCorrectionLifecycle = z.infer<typeof lifecycle>;

export type CorrectionRetentionPlan = { kind: "planned"; lifecycle: ContactFreeCorrectionLifecycle;
  payloadExpiresAtMs: number; recordExpiresAtMs: number } | { kind: "held"; reason: "invalid_context" };

export function planCorrectionRetention(input: unknown): CorrectionRetentionPlan {
  try {
    const parsed = lifecycle.safeParse(input);
    if (!parsed.success) return { kind: "held", reason: "invalid_context" };
    const value = parsed.data;
    return { kind: "planned", lifecycle: value,
      payloadExpiresAtMs: Math.min(value.receivedAtMs + contactFreeCorrectionPolicy.payloadLifetimeMs,
        value.closedAtMs === null ? Infinity : value.closedAtMs + contactFreeCorrectionPolicy.closedPayloadLifetimeMs,
        value.erasedAtMs === null ? Infinity : value.erasedAtMs),
      recordExpiresAtMs: value.receivedAtMs + contactFreeCorrectionPolicy.recordLifetimeMs };
  } catch {
    // Untrusted objects can refuse inspection; no exception/body is returned.
    return { kind: "held", reason: "invalid_context" };
  }
}

export type CorrectionRetentionObservation =
  | { kind: "observed"; reportId: string; payloadAccess: "available" | "expired";
      recordAccess: "available" | "expired"; payloadExpiresAtMs: number; recordExpiresAtMs: number }
  | { kind: "held"; reason: "invalid_context" | "invalid_clock" };

export function observeCorrectionRetention(input: unknown, nowMs: unknown): CorrectionRetentionObservation {
  const plan = planCorrectionRetention(input);
  if (plan.kind === "held") return plan;
  return observePlan(plan, nowMs);
}

function observePlan(plan: Extract<CorrectionRetentionPlan, { kind: "planned" }>, nowMs: unknown): CorrectionRetentionObservation {
  try {
    const parsed = instant.safeParse(nowMs);
    const value = plan.lifecycle;
    if (!parsed.success || parsed.data < value.receivedAtMs ||
        value.closedAtMs !== null && value.closedAtMs > parsed.data ||
        value.erasedAtMs !== null && value.erasedAtMs > parsed.data) return { kind: "held", reason: "invalid_clock" };
    return { kind: "observed", reportId: value.reportId,
      payloadAccess: parsed.data < plan.payloadExpiresAtMs ? "available" : "expired",
      recordAccess: parsed.data < plan.recordExpiresAtMs ? "available" : "expired",
      payloadExpiresAtMs: plan.payloadExpiresAtMs, recordExpiresAtMs: plan.recordExpiresAtMs };
  } catch { return { kind: "held", reason: "invalid_clock" }; }
}

// A payload copy has its own shorter physical residency limit. Current source
// lifecycle still governs restoration: a recent backup never renews access.
// The caller must supply the latest trusted erasure/closure state, not a stale
// lifecycle from the backup. This pure function does not authenticate that state.
export function observeCorrectionBackup(input: unknown, copiedAtMs: unknown, nowMs: unknown) {
  const plan = planCorrectionRetention(input);
  if (plan.kind === "held") return { kind: "held" as const };
  const observed = observePlan(plan, nowMs);
  if (observed.kind === "held") return { kind: "held" as const };
  try {
    const copied = instant.safeParse(copiedAtMs);
    if (!copied.success || copied.data < plan.lifecycle.receivedAtMs || copied.data > (nowMs as number) ||
        copied.data > Number.MAX_SAFE_INTEGER - contactFreeCorrectionPolicy.backupLifetimeMs ||
        copied.data >= plan.payloadExpiresAtMs) return { kind: "held" as const };
    const backupExpiresAtMs = Math.min(copied.data + contactFreeCorrectionPolicy.backupLifetimeMs,
      plan.lifecycle.receivedAtMs + contactFreeCorrectionPolicy.payloadLifetimeMs,
      plan.lifecycle.closedAtMs === null ? Infinity : plan.lifecycle.closedAtMs + contactFreeCorrectionPolicy.closedPayloadLifetimeMs);
    return { kind: "observed" as const, reportId: plan.lifecycle.reportId, backupExpiresAtMs,
      backupResidency: (nowMs as number) < backupExpiresAtMs ? "within_limit" as const : "expired" as const,
      restoredPayloadAccess: (nowMs as number) < backupExpiresAtMs ? observed.payloadAccess : "expired" as const };
  } catch { return { kind: "held" as const }; }
}
