import { z } from "zod";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";
import { correctionTargetSchema } from "./correction-target.ts";
import { inventedCorrectionLatestInventorySchema } from "./invented-contact-free-recovery.ts";
import { inventedWriteRecoveryOperationSchema, planInventedContactFreeWriteRecovery } from "./invented-contact-free-write-recovery.ts";

// Coherent metadata shape/cross-field checks only. No source authentication,
// restore, settlement, shared-service restart or real provider is established.
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().safe().nonnegative().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const writeSchema = inventedCorrectionLatestInventorySchema.extend({ kind: z.literal("invented_write_latest_inventory"),
  executionId: id, known: z.literal(true), operations: z.array(inventedWriteRecoveryOperationSchema).max(400) });
const bucket = z.strictObject({ key: id, epoch: z.number().int().safe().nonnegative(),
  expiresAtMs: z.number().int().safe().nonnegative(), attempts: z.array(instant).max(limits.attemptsPerAddress) });
const reservation = z.strictObject({ ticket: id, operationId: id.nullable(), admittedAtMs: instant.nullable(),
  phase: z.enum(["reserved", "armed", "dispatched", "expired"]), requestId: id.nullable(), target: correctionTargetSchema.nullable() });
const admissionSchema = z.strictObject({ acceptedAtMs: z.array(instant).max(limits.acceptedPerHour),
  addressBuckets: z.array(bucket).max(limits.openReports * 2),
  reservations: z.array(reservation).max(limits.concurrentAdmissions) });
const schema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("invented_shared_recovery_inventory"),
  writeInventory: writeSchema, admission: admissionSchema });
const held = () => ({ kind: "held" as const });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function checkInventedContactFreeSharedInventory(input: unknown, nowInput: unknown) {
  try {
    const now = instant.parse(nowInput), parsed = schema.parse(input), current = parsed.writeInventory;
    if (current.observedAtMs !== now || parsed.admission.acceptedAtMs.some(t => t > now || t <= now - limits.globalWindowMs)) return held();
    // The existing planner validates complete current record/operation identity
    // and chronology. An empty synthetic backup here supplies no bytes/copy trust.
    const checked = planInventedContactFreeWriteRecovery({ schemaVersion: 1, kind: "invented_write_backup_inventory",
      executionId: current.executionId, copiedAtMs: now, records: [], operations: [] }, current, now);
    if (checked.kind !== "planned_invented_write_recovery" || checked.recordActions.some(a => a.latestRecord === null) ||
        checked.operationActions.some(a => a.latestOperation === null)) return held();
    const epoch = Math.floor(now / limits.addressWindowMs), buckets = new Set<string>();
    for (const value of parsed.admission.addressBuckets) {
      if (buckets.has(value.key) || value.epoch !== epoch && value.epoch !== epoch - 1 ||
          value.expiresAtMs !== (value.epoch + 2) * limits.addressWindowMs || now >= value.expiresAtMs ||
          value.attempts.some(t => t > now || t <= now - limits.addressWindowMs || Math.floor(t / limits.addressWindowMs) !== value.epoch) ||
          value.attempts.some((t, index) => index > 0 && t < value.attempts[index - 1]!)) return held();
      buckets.add(value.key);
    }
    const tickets = new Set<string>(), operations = new Set<string>();
    const effects = new Map(current.operations.map(o => [o.operationId, o]));
    for (const value of parsed.admission.reservations) {
      if (tickets.has(value.ticket)) return held(); tickets.add(value.ticket);
      if (value.phase === "expired") {
        if (value.operationId !== null || value.admittedAtMs !== null || value.requestId !== null || value.target !== null) return held();
        continue; // Opaque unknown debt has no retired operation/body references.
      }
      if (value.operationId === null || value.admittedAtMs === null || value.admittedAtMs > now ||
          now >= value.admittedAtMs + limits.recordLifetimeMs || operations.has(value.operationId)) return held();
      operations.add(value.operationId);
      if ((value.phase === "reserved") !== (value.requestId === null) || (value.requestId === null) !== (value.target === null)) return held();
      const effect = effects.get(value.operationId);
      if (effect && (value.phase !== "dispatched" || effect.admittedAtMs !== value.admittedAtMs ||
          effect.requestId !== value.requestId || !same(effect.target, value.target))) return held();
    }
    if (parsed.admission.acceptedAtMs.length + parsed.admission.reservations.length > limits.acceptedPerHour) return held();
    const openReports = current.records.filter(r => r.lifecycle.closedAtMs === null).length;
    return { kind: "checked_invented_shared_inventory" as const, inventory: parsed, openReports,
      acceptedInHour: parsed.admission.acceptedAtMs.length,
      admissionDisposition: parsed.admission.reservations.length === 0
        ? "snapshot_only_no_restart_authority" as const : "held_pending_or_unknown" as const };
  } catch { return held(); }
}
