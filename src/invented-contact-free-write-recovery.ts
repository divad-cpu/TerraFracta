import { z } from "zod";
import { correctionTargetSchema } from "./correction-target.ts";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";
import { planInventedCorrectionRecovery, inventedCorrectionBackupInventorySchema,
  inventedCorrectionLatestInventorySchema } from "./invented-contact-free-recovery.ts";

// Metadata reconciliation only. No database, bytes, operation settlement,
// shared admission restart or host trust is supplied by an inventory's shape.
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
export const inventedWriteRecoveryOperationSchema = z.strictObject({
  operationId: id, executionId: id, requestId: id, target: correctionTargetSchema,
  admittedAtMs: instant, expiresAtMs: z.number().int().nonnegative().safe(),
  state: z.enum(["recorded", "nonwrite"]), reportId: id.nullable(), inserted: z.boolean().nullable(),
}).refine(value => value.expiresAtMs > value.admittedAtMs &&
  value.expiresAtMs <= value.admittedAtMs + limits.recordLifetimeMs &&
  (value.state === "recorded") === (value.reportId !== null) &&
  (value.state === "recorded") === (value.inserted !== null));
type Operation = z.infer<typeof inventedWriteRecoveryOperationSchema>;
const backupSchema = inventedCorrectionBackupInventorySchema.extend({
  kind: z.literal("invented_write_backup_inventory"), executionId: id,
  operations: z.array(inventedWriteRecoveryOperationSchema).max(limits.openReports * 2),
});
const latestSchema = inventedCorrectionLatestInventorySchema.extend({
  kind: z.literal("invented_write_latest_inventory"), executionId: id, known: z.literal(true),
  operations: z.array(inventedWriteRecoveryOperationSchema).max(limits.openReports * 2),
});
type Record = z.infer<typeof inventedCorrectionLatestInventorySchema>["records"][number];
export type InventedWriteRecoveryOperationAction = {
  operationId: string; backupOperation: Operation | null; latestOperation: Operation | null;
};
const held = () => ({ kind: "held" as const });
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function operations(input: Operation[], records: Record[], executionId: string, at: number, copying: boolean) {
  const indexed = new Map<string, Operation>(), reports = new Map(records.map(record => [record.lifecycle.reportId, record]));
  const insertionOwners = new Set<string>();
  for (const operation of input) {
    if (indexed.has(operation.operationId) || operation.executionId !== executionId || operation.admittedAtMs > at ||
        copying && at >= operation.expiresAtMs) return null;
    if (operation.state === "nonwrite") {
      if (operation.expiresAtMs !== operation.admittedAtMs + limits.recordLifetimeMs) return null;
    } else {
      if (operation.inserted === true) {
        if (insertionOwners.has(operation.reportId!)) return null;
        insertionOwners.add(operation.reportId!);
      }
      const record = reports.get(operation.reportId!);
      if (record) {
        if (record.requestId !== operation.requestId || !same(record.target, operation.target) ||
            operation.inserted === true && record.lifecycle.receivedAtMs < operation.admittedAtMs ||
            operation.expiresAtMs !== Math.min(operation.admittedAtMs + limits.recordLifetimeMs,
              record.lifecycle.receivedAtMs + limits.recordLifetimeMs)) return null;
      } else if (copying || at < operation.expiresAtMs) return null;
    }
    indexed.set(operation.operationId, operation);
  }
  return indexed;
}

export function planInventedContactFreeWriteRecovery(backupInput: unknown, latestInput: unknown, nowInput: unknown) {
  try {
    // Parsing detaches each original target/lifecycle before reading the next
    // untrusted object. No body, URL, digest or address enters these contracts.
    const backup = backupSchema.parse(backupInput), latest = latestSchema.parse(latestInput), now = instant.parse(nowInput);
    if (backup.executionId !== latest.executionId || backup.copiedAtMs > latest.observedAtMs || latest.observedAtMs !== now) return held();
    const custody = planInventedCorrectionRecovery({ schemaVersion: 1, kind: "invented_backup_inventory",
      copiedAtMs: backup.copiedAtMs, records: backup.records }, { schemaVersion: 1, kind: "invented_latest_inventory",
      complete: true, observedAtMs: latest.observedAtMs, records: latest.records }, now);
    if (custody.kind !== "planned") return held();
    const old = operations(backup.operations, backup.records.map(entry => entry.record), backup.executionId, backup.copiedAtMs, true);
    const current = operations(latest.operations, latest.records, latest.executionId, now, false);
    if (!old || !current) return held();
    const insertionOwners = new Map<string, string>();
    for (const operation of [...old.values(), ...current.values()]) if (operation.inserted === true) {
      const prior = insertionOwners.get(operation.reportId!);
      if (prior !== undefined && prior !== operation.operationId) return held();
      insertionOwners.set(operation.reportId!, operation.operationId);
    }
    const operationActions: InventedWriteRecoveryOperationAction[] = [];
    for (const operationId of [...new Set([...old.keys(), ...current.keys()])].sort()) {
      const prior = old.get(operationId), present = current.get(operationId);
      // A committed operation effect is immutable. Reconciliation cannot turn
      // a nonwrite fence into a new write, change identity, renew a deadline,
      // or convert an inserted outcome to a repeat (or conversely).
      if (prior && present && !same(prior, present)) return held();
      operationActions.push({ operationId, backupOperation: prior ?? null,
        latestOperation: present && now < present.expiresAtMs ? present : null });
    }
    return { kind: "planned_invented_write_recovery" as const, executionId: latest.executionId,
      observedAtMs: now, recordActions: custody.actions, operationActions };
  } catch { return held(); }
}
