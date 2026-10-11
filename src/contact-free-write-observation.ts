import { z } from "zod";
import { correctionRequestReceiptSchema } from "./correction-request.ts";
import { correctionTargetSchema } from "./correction-target.ts";
import { contactFreeCorrectionPolicy as limits, planCorrectionRetention,
  observeCorrectionRetention } from "./contact-free-correction-policy.ts";

const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
export const inventedWriteIdentitySchema = z.strictObject({ executionId: id, operationId: id,
  requestId: id, target: correctionTargetSchema, admittedAtMs: instant });
export type InventedWriteIdentity = z.infer<typeof inventedWriteIdentitySchema>;
const confirmed = correctionRequestReceiptSchema.extend({ operationId: id,
  target: correctionTargetSchema, lifecycle: z.unknown(), version: z.number().int().positive().safe(),
  observedAtMs: instant, payloadAvailable: z.boolean() });
const envelope = z.strictObject({ executionId: id, operationId: id,
  outcome: z.enum(["confirmed", "known_nonwrite", "unknown"]), result: z.unknown() });

// Closed invented adapter observation, not proof of host authenticity or write
// delivery. The adapter owns the actual transaction and complete latest context.
// Unknown recovery reads this operation's original effect; it never submits again.
export function checkInventedContactFreeWriteObservation(input: unknown,
  identityInput: unknown, nowInput: unknown) {
  try {
    const expected = inventedWriteIdentitySchema.parse(identityInput);
    const now = instant.parse(nowInput), value = envelope.parse(input);
    if (now < expected.admittedAtMs || value.executionId !== expected.executionId ||
        value.operationId !== expected.operationId) return { kind: "held" as const };
    if (value.outcome !== "confirmed") return value.result === null
      ? { kind: value.outcome } : { kind: "held" as const };
    const result = confirmed.parse(value.result), plan = planCorrectionRetention(result.lifecycle);
    if (plan.kind !== "planned" || result.requestId !== expected.requestId ||
        result.operationId !== expected.operationId || result.reportId !== plan.lifecycle.reportId ||
        result.publicationId !== expected.target.publicationId || result.revision !== expected.target.revision ||
        JSON.stringify(result.target) !== JSON.stringify(expected.target) ||
        result.observedAtMs < expected.admittedAtMs || result.observedAtMs > now ||
        !result.replayed && plan.lifecycle.receivedAtMs < expected.admittedAtMs ||
        plan.lifecycle.closedAtMs !== null && plan.lifecycle.erasedAtMs !== null &&
        plan.lifecycle.closedAtMs > plan.lifecycle.erasedAtMs) return { kind: "held" as const };
    const observed = observeCorrectionRetention(plan.lifecycle, result.observedAtMs);
    const present = observeCorrectionRetention(plan.lifecycle, now);
    if (observed.kind !== "observed" || observed.recordAccess !== "available" ||
        present.kind !== "observed" || present.recordAccess !== "available" ||
        result.payloadAvailable !== (observed.payloadAccess === "available") ||
        result.payloadAvailable !== (present.payloadAccess === "available")) return { kind: "held" as const };
    // The caller receives detached metadata only. No body, URL, address or digest.
    return { kind: "confirmed" as const, replayed: result.replayed,
      lifecycle: plan.lifecycle, version: result.version, target: result.target,
      receipt: correctionRequestReceiptSchema.strip().parse(result) };
  } catch { return { kind: "held" as const }; }
}
