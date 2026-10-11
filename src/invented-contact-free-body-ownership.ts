import type { PublicReadOutcome } from "./public-read-outcome.ts";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";
import { createInventedContactFreeBodyReader } from "./invented-contact-free-body-reader.ts";
import { observeInventedContactFreeClock } from "./invented-contact-free-clock.ts";

// Reuse one established native reader per opaque lease. Physical retirement is
// observable per operation, not inferred from another reader's completion.
// This invented adapter owns no SQL quota, address identity or write authority.
type Reader = ReturnType<typeof createInventedContactFreeBodyReader>;
type Lease = { reader: Reader; phase: "reading" | "prepared" | "held"; admittedAtMs: number; observationAtMs: number };
const held = () => ({ kind: "held" as const });

export function createInventedContactFreeBodyOwnership(clockToken: unknown) {
  if (observeInventedContactFreeClock(clockToken).kind !== "observed") return held();
  const leases = new WeakMap<object, Lease>();
  const owned = new Set<Lease>();
  let known = true;
  function loseContext() {
    if (!known) return held();
    known = false;
    for (const lease of owned) lease.reader.loseContext();
    return held();
  }
  function snapshot() {
    const value = observeInventedContactFreeClock(clockToken);
    if (!known || value.kind !== "observed") { loseContext(); return null; }
    // Cleanup/cancel can fail after the original held observer was delivered.
    // Every still-owned context and original UTC lease precedes new body work.
    for (const lease of owned) if (lease.reader.inspection().held || value.utcAtMs >= lease.admittedAtMs + limits.payloadLifetimeMs) {
      loseContext(); return null;
    }
    return value;
  }
  function begin(request: Request, current: () => PublicReadOutcome) {
    if (!known || owned.size >= limits.concurrentAdmissions) return held();
    const start = snapshot();
    if (start === null) return held();
    // Own this operation before any native-object or current-projection access.
    const token = Object.freeze({});
    const lease: Lease = { reader: undefined as unknown as Reader, phase: "reading", admittedAtMs: start.utcAtMs, observationAtMs: start.observationAtMs };
    lease.reader = createInventedContactFreeBodyReader("fresh_invented_trial", () => {
      const at = snapshot();
      if (at === null || at.utcAtMs >= lease.admittedAtMs + limits.payloadLifetimeMs) {
        loseContext(); throw Error("Invented body owner held");
      }
      return at.observationAtMs;
    });
    owned.add(lease); leases.set(token, lease);
    const observation = lease.reader.prepare(request, current).then(result => {
      // A final native signal getter runs after the reader's own last clock.
      // Observe the owned joint clock after that foreign access and before any
      // prepared output. Timer cleanup never erases the original2s deadline.
      const at = snapshot();
      if (result.kind === "prepared" && (at === null || at.observationAtMs - lease.observationAtMs >= 2_000)) {
        lease.phase = "held"; loseContext(); return held();
      }
      lease.phase = result.kind === "prepared" ? "prepared" : "held";
      if (lease.reader.inspection().held) loseContext();
      return result;
    }, () => { lease.phase = "held"; loseContext(); return held(); });
    return Object.freeze({ kind: "owned_invented_body" as const, token, observation });
  }
  function retire(token: unknown) {
    const lease = typeof token === "object" && token !== null ? leases.get(token) : undefined;
    if (lease === undefined || lease.phase === "reading" || lease.reader.inspection().activeReads !== 0) return held();
    const at = snapshot();
    if (lease.reader.inspection().held || at !== null && at.utcAtMs >= lease.admittedAtMs + limits.payloadLifetimeMs) loseContext();
    // No callback runs between native physical ownership read and retirement.
    // This proves neither a SQL nonwrite nor quota settlement or restart trust.
    leases.delete(token as object); owned.delete(lease);
    return Object.freeze({ kind: "physically_retired_invented_body" as const, preparation: lease.phase, contextKnown: known });
  }
  function cancel(token: unknown) {
    const lease = typeof token === "object" && token !== null ? leases.get(token) : undefined;
    if (lease === undefined) return held();
    // Manual fixture cancellation lacks a native parent-abort provenance. Lose
    // this factory's context rather than masking a later cleanup failure.
    return loseContext();
  }
  return Object.freeze({ kind: "ready" as const, begin, retire, cancel, loseContext,
    inspection: () => {
      snapshot();
      return Object.freeze({ held: !known, ownedLeases: owned.size,
        physicalReads: [...owned].reduce((sum, lease) => sum + lease.reader.inspection().activeReads, 0) });
    } });
}
