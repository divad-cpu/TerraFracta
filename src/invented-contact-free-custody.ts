import { z } from "zod";
import { correctionTargetSchema, correctionDraftFieldsSchema } from "./correction-target.ts";
import { contactFreeCorrectionPolicy as limits, planCorrectionRetention,
  observeCorrectionRetention, observeCorrectionBackup, type ContactFreeCorrectionLifecycle } from "./contact-free-correction-policy.ts";

// Invented, process-local custody model. No disk, database, endpoint, scheduler,
// authentication or encryption. Holding a facade is a capability in this model;
// a deployed host must separately authenticate principals and isolate roles.
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().nonnegative().safe();
const reason = z.enum(["corrected", "unsubstantiated", "duplicate", "outside_scope", "withdrawn"]);
const resolution = z.string().min(1).max(1000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const payloadSchema = correctionDraftFieldsSchema.extend({
  details: z.string().refine(value => value === value.trim()).pipe(correctionDraftFieldsSchema.shape.details),
  sourceUrl: z.string().refine(value => value === value.trim()).pipe(correctionDraftFieldsSchema.shape.sourceUrl),
  resolution: resolution.nullable(),
}).strict();
const fixtureSchema = z.strictObject({ lifecycle: z.unknown(), requestId: id,
  target: correctionTargetSchema, payload: payloadSchema,
  closedReason: reason.nullable(), reviewerId: id.nullable() });
const backupSchema = z.strictObject({ schemaVersion: z.literal(1), reportId: id, requestId: id,
  target: correctionTargetSchema, version: z.number().int().positive().safe(),
  copiedAtMs: instant, payload: payloadSchema });
const closureSchema = z.strictObject({ reportId: id, reviewerId: id, reason,
  resolution: resolution.nullable() });
const erasureSchema = z.strictObject({ reportId: id, reason: z.enum(["reporter_request", "sensitive_material"]) });
type Payload = z.infer<typeof payloadSchema>;
type Record = { lifecycle: ContactFreeCorrectionLifecycle; requestId: string;
  target: z.infer<typeof correctionTargetSchema>; closedReason: z.infer<typeof reason> | null;
  reviewerId: string | null; version: number };
const held = () => ({ kind: "held" as const });
const clone = <T>(value: T): T => structuredClone(value);

export function createInventedContactFreeCustody(fixtures: unknown, clock: () => unknown) {
  const records = new Map<string, Record>(), payloads = new Map<string, Payload>();
  const issuedBackups = new WeakSet<object>();
  let lastNow = -1, contextKnown = true, observingClock = false;
  try {
    const parsed = z.array(fixtureSchema).max(limits.openReports).parse(fixtures);
    const requestIds = new Set<string>();
    for (let index = 0; index < parsed.length; index++) {
      const fixture = parsed[index], plan = planCorrectionRetention(fixture.lifecycle);
      if (plan.kind !== "planned" || records.has(plan.lifecycle.reportId) || requestIds.has(fixture.requestId) ||
          (plan.lifecycle.closedAtMs === null) !== (fixture.closedReason === null) ||
          (fixture.closedReason === null) !== (fixture.reviewerId === null) ||
          fixture.closedReason === null && fixture.payload.resolution !== null) return held();
      records.set(plan.lifecycle.reportId, { lifecycle: plan.lifecycle, requestId: fixture.requestId,
        target: fixture.target, closedReason: fixture.closedReason, reviewerId: fixture.reviewerId, version: 1 });
      payloads.set(plan.lifecycle.reportId, fixture.payload);
      requestIds.add(fixture.requestId);
    }
  } catch { return held(); }

  // One trusted clock observation per operation. A rollback cannot reopen data.
  function sweep() {
    if (!contextKnown || observingClock) return null;
    observingClock = true;
    try {
      const now = instant.parse(clock());
      if (!contextKnown || now < lastNow) return null;
      for (const record of records.values()) {
        if (observeCorrectionRetention(record.lifecycle, now).kind === "held") return null;
      }
      lastNow = now;
      let removedPayloads = 0, removedRecords = 0;
      for (const [reportId, record] of records) {
        const observation = observeCorrectionRetention(record.lifecycle, now);
        if (observation.kind !== "observed") return null;
        if (observation.payloadAccess === "expired") {
          if (payloads.delete(reportId)) removedPayloads++;
          if (record.lifecycle.erasedAtMs === null) {
            record.lifecycle.erasedAtMs = now;
            record.lifecycle.eraseReason = "expired";
            record.version++;
          }
        }
        if (observation.recordAccess === "expired") { records.delete(reportId); removedRecords++; }
      }
      return { now, removedPayloads, removedRecords };
    } catch { return null; }
    finally { observingClock = false; }
  }
  function select(reportId: unknown) {
    const swept = sweep();
    if (!swept) return null;
    const parsed = id.safeParse(reportId);
    const record = parsed.success ? records.get(parsed.data) : undefined;
    return record ? { reportId: parsed.data!, record, now: swept.now } : null;
  }
  function read(reportId: unknown) {
    try {
      const selected = select(reportId);
      if (!selected) return held();
      const payload = payloads.get(selected.reportId);
      if (!payload) return held();
      const plan = planCorrectionRetention(selected.record.lifecycle);
      if (plan.kind !== "planned" || selected.now >= plan.payloadExpiresAtMs) return held();
      // A returned private copy is a lease, not a revocable reference. Its caller
      // must enforce this deadline and later erasure; no public export is created.
      return { kind: "private_copy" as const, reportId: selected.reportId,
        target: clone(selected.record.target), payload: clone(payload), expiresAtMs: plan.payloadExpiresAtMs };
    } catch { return held(); }
  }

  const reviewer = Object.freeze({
    read,
    exportPrivateCopy: read,
    close(input: unknown) {
      try {
        const request = closureSchema.parse(input), selected = select(request.reportId);
        if (!selected || selected.record.lifecycle.closedAtMs !== null || selected.record.lifecycle.erasedAtMs !== null ||
            !payloads.has(selected.reportId)) return held();
        selected.record.lifecycle.closedAtMs = selected.now;
        selected.record.closedReason = request.reason;
        selected.record.reviewerId = request.reviewerId;
        selected.record.version++;
        payloads.get(selected.reportId)!.resolution = request.resolution;
        return { kind: "closed_private" as const, reportId: selected.reportId };
      } catch { return held(); }
    },
    erase(input: unknown) {
      try {
        const request = erasureSchema.parse(input), selected = select(request.reportId);
        if (!selected) return held();
        if (selected.record.lifecycle.erasedAtMs === null) {
          selected.record.lifecycle.erasedAtMs = selected.now;
          selected.record.lifecycle.eraseReason = request.reason;
          selected.record.version++;
        }
        payloads.delete(selected.reportId);
        return { kind: "erased_private" as const, reportId: selected.reportId };
      } catch { return held(); }
    },
  });
  const custodian = Object.freeze({
    sweep() {
      const result = sweep();
      return result ? { kind: "swept" as const, removedPayloads: result.removedPayloads,
        removedRecords: result.removedRecords } : held();
    },
    minimalRecord(reportId: unknown) {
      try {
        const selected = select(reportId);
        return selected ? { kind: "minimal_record" as const, record: clone(selected.record) } : held();
      } catch { return held(); }
    },
    backup(reportId: unknown) {
      try {
        const selected = select(reportId);
        if (!selected || !payloads.has(selected.reportId)) return held();
        const observation = observeCorrectionBackup(selected.record.lifecycle, selected.now, selected.now);
        if (observation.kind !== "observed" || observation.restoredPayloadAccess !== "available") return held();
        const backup = Object.freeze({ schemaVersion: 1 as const, reportId: selected.reportId,
          requestId: selected.record.requestId, target: Object.freeze(clone(selected.record.target)),
          version: selected.record.version, copiedAtMs: selected.now,
          payload: Object.freeze(clone(payloads.get(selected.reportId)!)) });
        issuedBackups.add(backup);
        return { kind: "private_backup" as const, expiresAtMs: observation.backupExpiresAtMs, backup };
      } catch { return held(); }
    },
    restore(input: unknown) {
      try {
        // Object provenance is only an invented single-process backup authority.
        // A copied/decoded/restarted backup needs separately proven host recovery.
        if (typeof input !== "object" || input === null || !issuedBackups.has(input)) return held();
        const backup = backupSchema.parse(input), selected = select(backup.reportId);
        if (!selected || selected.record.version !== backup.version || selected.record.requestId !== backup.requestId ||
            JSON.stringify(selected.record.target) !== JSON.stringify(backup.target)) return held();
        const observation = observeCorrectionBackup(selected.record.lifecycle, backup.copiedAtMs, selected.now);
        if (observation.kind !== "observed" || observation.restoredPayloadAccess !== "available" ||
            payloads.has(selected.reportId)) return held();
        payloads.set(selected.reportId, backup.payload);
        return { kind: "restored_private" as const, reportId: selected.reportId };
      } catch { return held(); }
    },
    // Deliberate invented fault seams. Neither authorizes production deletion.
    losePayloadForTrial(reportId: unknown) {
      try {
        const selected = select(reportId);
        if (!selected) return held();
        payloads.delete(selected.reportId);
        return { kind: "lost_for_trial" as const };
      } catch { return held(); }
    },
    loseContextForTrial() { contextKnown = false; return { kind: "unknown_for_trial" as const }; },
  });
  return { kind: "ready" as const, reviewer, custodian };
}
