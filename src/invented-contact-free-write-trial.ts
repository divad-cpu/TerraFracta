import { z } from "zod";
import { claimInventedContactFreeBodyHandoff, observeInventedContactFreeBodyOrigin, retireInventedContactFreeBodyOrigin } from "./invented-contact-free-body-handoff.ts";
import type { PublicReadOutcome } from "./public-read-outcome.ts";
import type { CorrectionRequest } from "./correction-request.ts";
import { contactFreeCorrectionPolicy as limits, observeCorrectionRetention } from "./contact-free-correction-policy.ts";
import { createInventedContactFreeAdmission } from "./invented-contact-free-admission.ts";
import { createInventedContactFreeBodyReader } from "./invented-contact-free-body-reader.ts";
import { observeInventedContactFreeClock } from "./invented-contact-free-clock.ts";
import { inventedWriteIdentitySchema, checkInventedContactFreeWriteObservation,
  type InventedWriteIdentity } from "./contact-free-write-observation.ts";

const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const identifiers = z.strictObject({ currentKey: id, previousKey: id,
  epoch: z.number().int().nonnegative().safe() });
const observationMs = 2_000;
const nativeNow = performance.now.bind(performance);
const held = () => ({ kind: "held" as const });
type Result = { kind: "held" } | { kind: "recorded_invented"; receipt: unknown } | { kind: "resolved_invented" };
export type InventedContactFreeWritePorts = Readonly<{ executionId: string;
  nextOperationId: () => unknown;
  write: (input: Readonly<{ executionId: string; operationId: string; request: CorrectionRequest; admittedAtMs: number }>, signal: AbortSignal, mayDispatchNextForTrial: () => boolean) => Promise<unknown>;
  recover: (input: Readonly<InventedWriteIdentity>, signal: AbortSignal) => Promise<unknown>;
}>;
type Operation = { ticket: object; reservation: object; identity: InventedWriteIdentity | null; expiresAtMs: number | null;
  origin: object | null; state: "pending" | "unknown"; physical: boolean; finishing: boolean; interrupt: (() => void) | null };

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

// Invented private coordination only. Ports and clocks are trusted fixture
// authority, never authenticated host/transport/SQL capabilities. No endpoint,
// automatic retry, live provider, report persistence or public status exists.
export function createInventedContactFreeWriteTrial(fixture: unknown, ports: InventedContactFreeWritePorts,
  clockToken: unknown) {
  if (observeInventedContactFreeClock(clockToken).kind !== "observed") return held();
  let executionId: string, write: InventedContactFreeWritePorts["write"], recover: InventedContactFreeWritePorts["recover"];
  let nextOperationId: InventedContactFreeWritePorts["nextOperationId"];
  try {
    executionId = id.parse(ports.executionId); write = ports.write; recover = ports.recover; nextOperationId = ports.nextOperationId;
    if (typeof write !== "function" || typeof recover !== "function" || typeof nextOperationId !== "function") return held();
  } catch { return held(); }
  let known = true, lastUTC = -1, lastObservation = -1, observingUTC = false, observingTime = false;
  const operations = new Map<object, Operation>();
  const usedIds = new Map<string, number>();
  let admission: ReturnType<typeof createInventedContactFreeAdmission>;
  const body = createInventedContactFreeBodyReader("fresh_invented_trial", time);
  function loseContext() {
    known = false; body.loseContext();
    if (admission?.kind === "ready") admission.recovery.invalidateForTrial();
    for (const operation of operations.values()) operation.interrupt?.();
  }
  // A held writer can still retire its own expired metadata using a separately
  // known issued clock. This only removes references; it cannot dispatch a port,
  // recover an outcome, renew admission or make the held budget known again.
  function pruneOwnedMetadata() {
    if (observingUTC) return;
    if (known) { try { utc(); } catch { /* The already-held context stays held. */ } return; }
    const snapshot = observeInventedContactFreeClock(clockToken);
    if (snapshot.kind !== "observed" || snapshot.utcAtMs < lastUTC) return;
    const value = snapshot.utcAtMs;
    for (const [key, expires] of usedIds) if (value >= expires) usedIds.delete(key);
    for (const operation of operations.values()) if (operation.expiresAtMs !== null && value >= operation.expiresAtMs) {
      retireOrigin(operation); operation.identity = null; operation.expiresAtMs = null;
    }
  }
  function utc() {
    if (!known) { pruneOwnedMetadata(); throw Error("Invented clock held"); }
    if (observingUTC) throw Error("Invented clock held");
    observingUTC = true;
    try {
      const snapshot = observeInventedContactFreeClock(clockToken);
      if (snapshot.kind !== "observed") throw Error("Invented clock held");
      const value = instant.parse(snapshot.utcAtMs);
      if (!known || value < lastUTC) throw Error("Invented clock held");
      lastUTC = value;
      for (const [key, expires] of usedIds) if (value >= expires) usedIds.delete(key);
      // Retire owned identifiers at their original bound, preserving the opaque
      // uncertain reservation. Expiry cannot establish a known nonwrite.
      for (const operation of operations.values()) if (operation.expiresAtMs !== null && value >= operation.expiresAtMs) {
        retireOrigin(operation); operation.identity = null; uncertain(operation); operation.expiresAtMs = null;
      }
      budget.inspection.counts(); // Retire the same owned budget metadata too.
      return value;
    } catch { loseContext(); throw Error("Invented clock held"); }
    finally { observingUTC = false; }
  }
  function time() {
    if (!known || observingTime) throw Error("Invented observation held");
    observingTime = true;
    try {
      const snapshot = observeInventedContactFreeClock(clockToken);
      if (snapshot.kind !== "observed") throw Error("Invented observation held");
      const value = snapshot.observationAtMs;
      if (!known || !Number.isFinite(value) || value < 0 || value < lastObservation) throw Error("Invented observation held");
      lastObservation = value; return value;
    } catch { loseContext(); throw Error("Invented observation held"); }
    finally { observingTime = false; }
  }
  admission = createInventedContactFreeAdmission(fixture, () => {
    if (!known || lastUTC < 0) throw Error("Invented context held");
    return lastUTC; // Owned snapshot: settlement cannot invoke a foreign callback.
  });
  if (admission.kind !== "ready") return held();
  const budget = admission;

  function retireOrigin(operation: Operation) {
    if (operation.origin !== null) retireInventedContactFreeBodyOrigin(operation.origin, clockToken);
    operation.origin = null;
  }
  function uncertain(operation: Operation) {
    if (operation.state === "unknown") return;
    const settled = budget.writer.settle(operation.reservation, "unknown");
    operation.state = "unknown";
    if (settled.kind !== "uncertain") loseContext();
  }
  function settle(operation: Operation, outcome: "not_written" | "accepted") {
    const result = operation.state === "unknown"
      ? budget.recovery.resolve(operation.reservation, outcome)
      : budget.writer.settle(operation.reservation, outcome);
    if (result.kind !== (outcome === "accepted" ? "counted_accepted" : "released")) { loseContext(); return false; }
    retireOrigin(operation); operations.delete(operation.ticket); return true;
  }

  function observe(operation: Operation, request: Request | null,
    work: (signal: AbortSignal, mayDispatchNextForTrial: () => boolean) => Promise<unknown>, recovering: boolean): Promise<Result> {
    let deliver!: (value: Result) => void;
    const result = new Promise<Result>(resolve => { deliver = resolve; });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, attached = false, stopped = false, retired = false, dispatched = false;
    let started = 0;
    const nativeStarted = nativeNow();
    function interrupt() {
      if (retired || stopped) return;
      stopped = true;
      if (dispatched && !recovering) uncertain(operation);
      try { controller.abort(); } catch { loseContext(); }
      deliver(held());
    }
    function live() {
      try {
        if (operation.origin !== null && !observeInventedContactFreeBodyOrigin(operation.origin, clockToken, recovering ? "metadata" : "payload")) loseContext();
        const aborted = request?.signal.aborted ?? false;
        const elapsed = time() - started;
        const finalAbort = request?.signal.aborted ?? false;
        if (!known || stopped || aborted || finalAbort || elapsed >= observationMs || nativeNow() - nativeStarted >= observationMs) { interrupt(); return false; }
        return true;
      } catch { interrupt(); return false; }
    }
    let guardingNext = false;
    // Multi-step invented ports must use this original observer after their last
    // foreign access. A new phase clock would renew the original observation.
    // Eligibility is no SQL, host, principal or physical-retirement authority.
    function mayDispatchNextForTrial() {
      if (recovering || guardingNext || retired || stopped || !known || !dispatched) return false;
      guardingNext = true;
      try {
        const aborted = request?.signal.aborted ?? false;
        const originKnown = operation.origin === null || observeInventedContactFreeBodyOrigin(operation.origin, clockToken, "payload");
        // These owned reads follow every preceding foreign signal/issuer access.
        const now = utc(), elapsed = time() - started;
        return known && !retired && !stopped && !aborted && originKnown && operation.physical &&
          operation.identity !== null && now < operation.identity.admittedAtMs + limits.payloadLifetimeMs &&
          elapsed < observationMs && nativeNow() - nativeStarted < observationMs;
      } catch { return false; }
      finally { guardingNext = false; }
    }
    function cleanup() {
      retired = true; operation.interrupt = null;
      let clean = true;
      try { if (timer !== undefined) clearTimeout(timer); } catch { clean = false; }
      try { if (attached) request!.signal.removeEventListener("abort", interrupt); } catch { clean = false; }
      if (!clean) loseContext();
      return clean;
    }
    // Own physical work before any supplied clock, signal or port callback.
    operation.physical = true; operation.finishing = false; operation.interrupt = interrupt;
    try {
      started = time();
      if (request !== null) { attached = true; request.signal.addEventListener("abort", interrupt, { once: true }); }
      timer = setTimeout(interrupt, observationMs);
      if (!live()) throw Error("Invented setup held");
    } catch {
      interrupt(); cleanup(); operation.physical = false;
      if (!recovering) settle(operation, "not_written");
      return result;
    }
    void (async () => {
      let value: unknown, failed = false;
      try {
        if (live()) {
          // live's final native signal access is foreign. Observe the owned
          // joint clock AFTER it and enforce original identity before dispatch.
          const snapshot = observeInventedContactFreeClock(clockToken);
          if (snapshot.kind !== "observed") loseContext();
          else {
            const now = utc();
            if (operation.origin !== null && !observeInventedContactFreeBodyOrigin(operation.origin, clockToken, recovering ? "metadata" : "payload")) loseContext();
            if (known && !stopped && operation.identity !== null && operation.expiresAtMs !== null && now < operation.expiresAtMs &&
                snapshot.observationAtMs - started < observationMs && nativeNow() - nativeStarted < observationMs) {
              dispatched = true; value = await work(controller.signal, mayDispatchNextForTrial);
            }
          }
        }
      } catch { failed = true; }
      // Timer/parent/context retirement can finish the observer while this
      // physical work stays owned. A late result never settles its reservation.
      if (stopped || !known) {
        cleanup(); operation.physical = false;
        if (!dispatched && !recovering && known) settle(operation, "not_written");
        deliver(held()); return;
      }
      if (!dispatched && !recovering) {
        cleanup(); operation.physical = false;
        // No port was called. An expired pre-dispatch identity is a known
        // nonwrite even if its opaque reservation briefly became uncertain.
        if (known) settle(operation, "not_written");
        deliver(held()); return;
      }
      let checked: ReturnType<typeof checkInventedContactFreeWriteObservation> | undefined;
      let checkedAt = -1;
      try { if (!failed && live()) { checkedAt = utc(); checked = checkInventedContactFreeWriteObservation(value, operation.identity, checkedAt); } }
      catch { /* Context loss holds the outcome. No thrown adapter text escapes. */ }
      operation.finishing = true;
      const clean = cleanup(); operation.physical = false;
      let current = false;
      try {
        // Cleanup/signal/observer access may advance UTC after initial checking.
        // Validate only the detached result after the final foreign callback.
        const liveNow = clean && live();
        const finalAbort = request?.signal.aborted ?? false;
        // The final signal access is foreign; the following joint owned read
        // invokes no supplied callback. Both clocks refer to this same point.
        const snapshot = observeInventedContactFreeClock(clockToken);
        if (snapshot.kind !== "observed") throw Error("Invented final clock held");
        const now = utc(); // Same owned fixed UTC; prune original metadata bounds.
        const finalElapsed = snapshot.observationAtMs - started;
        const earlier = checked?.kind === "confirmed" ? observeCorrectionRetention(checked.lifecycle, checkedAt) : null;
        if (operation.origin !== null && !observeInventedContactFreeBodyOrigin(operation.origin, clockToken, recovering ? "metadata" : "payload")) loseContext();
        current = liveNow && finalElapsed < observationMs && nativeNow() - nativeStarted < observationMs &&
          !finalAbort && known && !stopped && operation.identity !== null &&
          operation.expiresAtMs !== null && now < operation.expiresAtMs && checked !== undefined &&
          (checked.kind === "known_nonwrite" || checked.kind === "confirmed" &&
            checkInventedContactFreeWriteObservation({ executionId, operationId: operation.identity.operationId,
              outcome: "confirmed", result: { ...checked.receipt, operationId: operation.identity.operationId,
                target: checked.target, lifecycle: checked.lifecycle, version: checked.version,
                observedAtMs: now, payloadAvailable: earlier?.kind === "observed" && earlier.payloadAccess === "available" } }, operation.identity, now).kind === "confirmed");
      } catch { /* Held continuity; never retry the physical write. */ }
      if (!current || checked === undefined || checked.kind === "held" || checked.kind === "unknown") {
        if (dispatched && !recovering) uncertain(operation);
        operation.finishing = false; deliver(held()); return;
      }
      if (checked.kind === "known_nonwrite") {
        if (settle(operation, "not_written")) deliver(recovering ? { kind: "resolved_invented" } : held());
        else deliver(held());
        operation.finishing = false; return;
      }
      if (!settle(operation, checked.replayed ? "not_written" : "accepted")) { operation.finishing = false; deliver(held()); return; }
      operation.finishing = false;
      deliver(recovering ? { kind: "resolved_invented" } : { kind: "recorded_invented", receipt: checked.receipt });
    })();
    return result;
  }

  async function submit(request: Request, keys: unknown, current: (() => PublicReadOutcome) | null,
    claimed: ReturnType<typeof claimInventedContactFreeBodyHandoff> | null = null): Promise<Result> {
      let selected: z.infer<typeof identifiers>;
      try { selected = identifiers.parse(keys); } catch { return held(); }
      if (!known) return held();
      let admittedAtMs: number;
      try {
        const at = utc();
        if (claimed !== null && (claimed.kind !== "claimed_invented_body" ||
            claimed.admission.executionId !== executionId || claimed.admission.admittedAtMs > at ||
            at >= claimed.admission.admittedAtMs + limits.payloadLifetimeMs ||
            !observeInventedContactFreeBodyOrigin(claimed.origin, clockToken, "payload"))) return held();
        admittedAtMs = claimed?.kind === "claimed_invented_body" ? claimed.admission.admittedAtMs : at;
      } catch { return held(); }
      const reservation = budget.writer.beginWithOriginalAdmissionForTrial({ ...selected, bodyBytes: 0 }, admittedAtMs);
      if (reservation.kind !== "reserved") return held();
      let operation: Operation | undefined;
      try {
        const outcome = claimed?.kind === "claimed_invented_body"
          ? { kind: "prepared" as const, request: claimed.prepared }
          : current === null ? held() : await body.prepare(request, current);
        if (body.inspection().held) loseContext();
        const aborted = request.signal.aborted;
        if (!known || outcome.kind !== "prepared" || aborted) {
          if (budget.writer.settle(reservation.token, "not_written").kind !== "released") loseContext();
          return held();
        }
        utc();
        const operationId = claimed?.kind === "claimed_invented_body"
          ? claimed.admission.operationId : id.parse(nextOperationId());
        if (claimed?.kind === "claimed_invented_body" && !observeInventedContactFreeBodyOrigin(claimed.origin, clockToken, "payload")) loseContext();
        if (!known || usedIds.has(operationId) || usedIds.size >= limits.openReports * 2 ||
            [...operations.values()].some(value => value.identity?.requestId === outcome.request.requestId)) {
          if (budget.writer.settle(reservation.token, "not_written").kind !== "released") loseContext();
          return held();
        }
        usedIds.set(operationId, admittedAtMs + limits.recordLifetimeMs);
        const identity = freeze(inventedWriteIdentitySchema.parse({ executionId, operationId,
          requestId: outcome.request.requestId, target: outcome.request.draft.target, admittedAtMs }));
        operation = { ticket: Object.freeze({}), reservation: reservation.token, identity,
          expiresAtMs: admittedAtMs + limits.recordLifetimeMs,
          origin: claimed?.kind === "claimed_invented_body" ? claimed.origin : null,
          state: "pending", physical: false, finishing: false, interrupt: null };
        operations.set(operation.ticket, operation);
        const input = freeze({ executionId, operationId, request: outcome.request, admittedAtMs });
        return observe(operation, request, (signal, guard) => write(input, signal, guard), false);
      } catch {
        if (operation !== undefined) uncertain(operation);
        else if (budget.writer.settle(reservation.token, "not_written").kind !== "released") loseContext();
        return held();
      }

  }
  return Object.freeze({ kind: "ready" as const,
    submit: (request: Request, keys: unknown, current: () => PublicReadOutcome) => submit(request, keys, current),
    submitPreparedForTrial(token: unknown, keys: unknown): Promise<Result> {
      const claimed = claimInventedContactFreeBodyHandoff(token, clockToken);
      if (claimed.kind !== "claimed_invented_body") return Promise.resolve(held());
      return submit(claimed.request, keys, null, claimed);
    }, loseContext,
    recovery: Object.freeze({
      pending() {
        try { utc(); } catch { return []; }
        return known ? [...operations.values()].filter(value => value.identity !== null && value.state === "unknown" && !value.physical && !value.finishing).map(value => value.ticket) : [];
      },
      recover(ticket: unknown): Promise<Result> {
        const operation = typeof ticket === "object" && ticket !== null ? operations.get(ticket) : undefined;
        if (!known || !operation || operation.state !== "unknown" || operation.physical || operation.finishing) return Promise.resolve(held());
        try { utc(); } catch { return Promise.resolve(held()); }
        if (!known || operation.identity === null || operation.physical || operation.finishing) return Promise.resolve(held());
        const identity = operation.identity;
        return observe(operation, null, signal => recover(identity, signal), true);
      },
    }),
    inspection: Object.freeze({ body: body.inspection, budget: () => { try { utc(); } catch { /* Inspect the held admission context. */ } return budget.inspection.counts(); },
      operations: () => {
        pruneOwnedMetadata();
        return Object.freeze({ held: !known, pending: operations.size,
          physical: [...operations.values()].filter(value => value.physical).length,
          retainedOperationIds: usedIds.size });
      } }),
  });
}
