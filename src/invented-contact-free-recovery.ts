import { z } from "zod";
import { correctionTargetSchema } from "./correction-target.ts";
import { contactFreeCorrectionPolicy as limits, planCorrectionRetention,
  observeCorrectionRetention, observeCorrectionBackup } from "./contact-free-correction-policy.ts";

// Bounded invented recovery planner, NOT trust/authentication of a manifest.
// It never opens a service, restores bytes, encrypts a backup or makes a public
// decision. A real host needs an independently trusted, complete newest context.
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const recordSchema = z.strictObject({ lifecycle: z.unknown().transform((input, context) => {
  const plan = planCorrectionRetention(input);
  if (plan.kind !== "planned") {
    context.addIssue({ code: "custom", message: "Recovery lifecycle differs" });
    return z.NEVER;
  }
  // Detach immediately: parsing the next untrusted inventory must not mutate
  // a lifecycle already accepted from the previous one.
  return plan.lifecycle;
}), requestId: id, target: correctionTargetSchema,
  closedReason: z.enum(["corrected", "unsubstantiated", "duplicate", "outside_scope", "withdrawn"]).nullable(),
  reviewerId: id.nullable(), version: z.number().int().positive().safe() });
type Record = z.infer<typeof recordSchema>;
const backupSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("invented_backup_inventory"),
  copiedAtMs: instant, records: z.array(z.strictObject({ record: recordSchema, hasPayload: z.boolean() })).max(200) });
const latestSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("invented_latest_inventory"),
  complete: z.literal(true), observedAtMs: instant, records: z.array(recordSchema).max(200) });
export type InventedRecoveryAction = { reportId: string; backupVersion: number | null;
  latestRecord: Record | null; payload: "keep" | "remove" };
const held = () => ({ kind: "held" as const });

function decodeRecord(input: z.infer<typeof recordSchema>, now: number): Record | null {
  const plan = planCorrectionRetention(input.lifecycle);
  if (plan.kind !== "planned" || observeCorrectionRetention(plan.lifecycle, now).kind !== "observed" ||
      (plan.lifecycle.closedAtMs === null) !== (input.closedReason === null) ||
      (input.closedReason === null) !== (input.reviewerId === null) ||
      plan.lifecycle.closedAtMs !== null && plan.lifecycle.erasedAtMs !== null &&
        plan.lifecycle.closedAtMs > plan.lifecycle.erasedAtMs) return null;
  return { ...input, lifecycle: plan.lifecycle };
}

export function planInventedCorrectionRecovery(backupInput: unknown, latestInput: unknown, nowInput: unknown) {
  try {
    const backup = backupSchema.parse(backupInput), latest = latestSchema.parse(latestInput), now = instant.parse(nowInput);
    // One owner-held recovery cutoff; an older inventory is not silently called
    // newest because it parses. Equality still does not authenticate its source.
    if (backup.copiedAtMs > latest.observedAtMs || latest.observedAtMs !== now) return held();
    const originals = new Map<string, { record: Record; hasPayload: boolean }>(), current = new Map<string, Record>();
    for (const entry of backup.records) {
      const record = decodeRecord(entry.record, backup.copiedAtMs);
      if (!record || originals.has(record.lifecycle.reportId)) return held();
      const observation = observeCorrectionRetention(record.lifecycle, backup.copiedAtMs);
      if (observation.kind !== "observed" || observation.recordAccess !== "available" ||
          entry.hasPayload && observation.payloadAccess !== "available") return held();
      originals.set(record.lifecycle.reportId, { record, hasPayload: entry.hasPayload });
    }
    for (const input of latest.records) {
      const record = decodeRecord(input, latest.observedAtMs);
      if (!record || current.has(record.lifecycle.reportId)) return held();
      current.set(record.lifecycle.reportId, record);
    }
    const requestOwners = new Map<string, string>();
    for (const collection of [originals.values(), current.values()]) {
      const requests = new Set<string>();
      for (const item of collection) {
        const record = "record" in item ? item.record : item;
        if (requests.has(record.requestId)) return held();
        requests.add(record.requestId);
        const priorOwner = requestOwners.get(record.requestId);
        if (priorOwner !== undefined && priorOwner !== record.lifecycle.reportId) return held();
        requestOwners.set(record.requestId, record.lifecycle.reportId);
      }
    }
    const actions: InventedRecoveryAction[] = [];
    const reportIds = [...new Set([...originals.keys(), ...current.keys()])].sort();
    for (const reportId of reportIds) {
      const original = originals.get(reportId), present = current.get(reportId);
      if (original && present) {
        const prior = original.record;
        if (prior.requestId !== present.requestId || JSON.stringify(prior.target) !== JSON.stringify(present.target) ||
            prior.lifecycle.receivedAtMs !== present.lifecycle.receivedAtMs || prior.version > present.version ||
            prior.lifecycle.closedAtMs === null && present.lifecycle.closedAtMs !== null &&
              present.lifecycle.closedAtMs < backup.copiedAtMs ||
            prior.lifecycle.erasedAtMs === null && present.lifecycle.erasedAtMs !== null &&
              present.lifecycle.erasedAtMs < backup.copiedAtMs ||
            prior.lifecycle.erasedAtMs !== null && prior.lifecycle.closedAtMs !== present.lifecycle.closedAtMs ||
            prior.lifecycle.closedAtMs !== null && (prior.lifecycle.closedAtMs !== present.lifecycle.closedAtMs ||
              prior.closedReason !== present.closedReason || prior.reviewerId !== present.reviewerId) ||
            prior.lifecycle.erasedAtMs !== null && (prior.lifecycle.erasedAtMs !== present.lifecycle.erasedAtMs ||
              prior.lifecycle.eraseReason !== present.lifecycle.eraseReason) ||
            prior.version === present.version && JSON.stringify(prior) !== JSON.stringify(present)) return held();
      }
      const observed = present ? observeCorrectionRetention(present.lifecycle, now) : null;
      if (observed?.kind === "held") return held();
      if (!present || observed?.recordAccess === "expired") {
        actions.push({ reportId, backupVersion: original?.record.version ?? null, latestRecord: null, payload: "remove" });
        continue;
      }
      const copy = observeCorrectionBackup(present.lifecycle, backup.copiedAtMs, now);
      const keep = original?.hasPayload === true && original.record.version === present.version &&
        copy.kind === "observed" && copy.restoredPayloadAccess === "available";
      actions.push({ reportId, backupVersion: original?.record.version ?? null,
        latestRecord: present, payload: keep ? "keep" : "remove" });
    }
    return { kind: "planned" as const, observedAtMs: now, actions };
  } catch { return held(); }
}

// Reuse the existing closed inventory contracts in the operation-ledger trial.
// Exporting their shape does not authenticate a manifest or authorize restore.
export const inventedCorrectionBackupInventorySchema = backupSchema;
export const inventedCorrectionLatestInventorySchema = latestSchema;
