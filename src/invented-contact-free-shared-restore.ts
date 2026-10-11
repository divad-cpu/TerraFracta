import { z } from "zod";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";
import { inventedCorrectionBackupInventorySchema } from "./invented-contact-free-recovery.ts";
import { inventedWriteRecoveryOperationSchema, planInventedContactFreeWriteRecovery } from "./invented-contact-free-write-recovery.ts";
import { checkInventedContactFreeSharedInventory } from "./invented-contact-free-shared-inventory.ts";

// Historical private scrub plan only. Shared admission and ordinary writer remain
// held, even when metadata parses or no pending reservation appears in a copy.
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().safe().nonnegative().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const writeBackupSchema = inventedCorrectionBackupInventorySchema.extend({ kind: z.literal("invented_write_backup_inventory"),
  executionId: id, operations: z.array(inventedWriteRecoveryOperationSchema).max(400) });
const held = () => ({ kind: "held" as const });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ordered = <T>(values: T[], key: (value: T) => string) => [...values].sort((a, b) => key(a).localeCompare(key(b)));

export function planInventedContactFreeSharedRestore(backupInput: unknown, latestInput: unknown, nowInput: unknown) {
  try {
    const now = instant.parse(nowInput);
    let copiedAt = -1;
    const backupSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("invented_shared_backup_inventory"),
      writeBackup: writeBackupSchema.transform(value => { copiedAt = value.copiedAtMs; return value; }),
      sharedInventory: z.unknown().transform((input, context) => {
        const checked = checkInventedContactFreeSharedInventory(input, copiedAt);
        if (checked.kind !== "checked_invented_shared_inventory") { context.addIssue({ code: "custom", message: "Invented copy differs" }); return z.NEVER; }
        return checked.inventory;
      }) });
    const old = backupSchema.parse(backupInput);
    // Earlier schemas detach source identity before later untrusted accessors.
    const current = checkInventedContactFreeSharedInventory(latestInput, now);
    if (current.kind !== "checked_invented_shared_inventory") return held();
    const priorWrite = old.sharedInventory.writeInventory, latest = current.inventory;
    if (old.writeBackup.executionId !== priorWrite.executionId || priorWrite.executionId !== latest.writeInventory.executionId ||
        copiedAt > now || !same(ordered(old.writeBackup.records.map(r => r.record), r => r.lifecycle.reportId),
          ordered(priorWrite.records, r => r.lifecycle.reportId)) ||
        !same(ordered(old.writeBackup.operations, o => o.operationId), ordered(priorWrite.operations, o => o.operationId))) return held();
    const custody = planInventedContactFreeWriteRecovery(old.writeBackup, latest.writeInventory, now);
    if (custody.kind !== "planned_invented_write_recovery") return held();
    function retainsTimes(prior: number[], present: number[], cutoff: number) {
      const counts = new Map<number, number>();
      for (const value of present) counts.set(value, (counts.get(value) ?? 0) + 1);
      for (const value of prior) if (value > cutoff) {
        const count = counts.get(value) ?? 0;
        if (count === 0) return false;
        counts.set(value, count - 1);
      }
      return true;
    }
    if (!retainsTimes(old.sharedInventory.admission.acceptedAtMs, latest.admission.acceptedAtMs, now - 3_600_000)) return held();
    const buckets = new Map(latest.admission.addressBuckets.map(bucket => [bucket.key, bucket]));
    for (const prior of old.sharedInventory.admission.addressBuckets) {
      const present = buckets.get(prior.key);
      // A retained identifier cannot become the next epoch's identifier. Even
      // empty attempts retain their original bucket until its original expiry.
      if (present === undefined) { if (prior.expiresAtMs > now) return held(); continue; }
      if (present.epoch !== prior.epoch || present.expiresAtMs !== prior.expiresAtMs ||
          !retainsTimes(prior.attempts, present.attempts, now - limits.addressWindowMs)) return held();
    }
    const reservations = new Map(latest.admission.reservations.map(r => [r.ticket, r]));
    const effects = new Map(latest.writeInventory.operations.map(o => [o.operationId, o]));
    const phase = { reserved: 0, armed: 1, dispatched: 2, expired: 3 };
    for (const prior of old.sharedInventory.admission.reservations) {
      const present = reservations.get(prior.ticket);
      if (present) {
        if (phase[present.phase] < phase[prior.phase]) return held();
        if (present.phase === "expired") {
          if (prior.phase !== "expired" && (prior.admittedAtMs === null || now < prior.admittedAtMs + limits.recordLifetimeMs)) return held();
        } else if (prior.operationId !== present.operationId || prior.admittedAtMs !== present.admittedAtMs ||
            prior.requestId !== null && (prior.requestId !== present.requestId || !same(prior.target, present.target))) return held();
        continue;
      }
      // Latest complete absence is not a physical-body or unknown-write proof.
      // A retained matching immutable effect can explain an explicit resolution;
      // retired identity or a missing prewrite outcome cannot manufacture it.
      const effect = prior.operationId === null ? undefined : effects.get(prior.operationId);
      if (prior.phase === "reserved" || prior.phase === "expired" || effect === undefined ||
          effect.admittedAtMs !== prior.admittedAtMs || effect.requestId !== prior.requestId || !same(effect.target, prior.target)) return held();
    }
    return { kind: "planned_invented_shared_restore" as const, executionId: custody.executionId, observedAtMs: now,
      recordActions: custody.recordActions, operationActions: custody.operationActions,
      latestAdmission: latest.admission, admissionHeld: true as const, writerEnabled: false as const };
  } catch { return held(); }
}
