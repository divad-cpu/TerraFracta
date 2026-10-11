import { z } from "zod";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";

// Single-process invented budget, never a live limiter or intake endpoint.
// Client keys are trusted fixture rotation tokens, NOT raw addresses/headers.
// A real transport must supply authenticated provenance and shared continuity;
// this component cannot establish either and cannot restore a running service.
const instant = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const inputSchema = z.strictObject({ currentKey: id, previousKey: id,
  epoch: z.number().int().nonnegative().safe(), bodyBytes: z.number().int().nonnegative().safe() })
  .refine(value => value.currentKey !== value.previousKey);
const fixtureSchema = z.strictObject({ kind: z.literal("fresh_invented_trial"),
  openReports: z.number().int().min(0).max(limits.openReports),
  acceptedAtMs: z.array(instant).max(limits.acceptedPerHour) });
type Reservation = { state: "pending" | "unknown" | "settled"; admittedAtMs: number | null };
type Bucket = { epoch: number; expiresAtMs: number; attempts: number[] };
type HoldReason = "invalid_context" | "invalid_clock" | "body_limit" | "address_limit" |
  "busy" | "global_limit" | "open_limit" | "uncertain" | "capacity";
const held = (reason: HoldReason) => ({ kind: "held" as const, reason });

export function createInventedContactFreeAdmission(fixture: unknown, clock: () => unknown) {
  let accepted: number[], open: number;
  try {
    const parsed = fixtureSchema.parse(fixture);
    accepted = parsed.acceptedAtMs; open = parsed.openReports;
  } catch { return held("invalid_context"); }
  let lastNow = -1, observingClock = false, contextKnown = true;
  const buckets = new Map<string, Bucket>();
  const reservations = new Map<object, Reservation>();
  const acceptedReports = new Map<object, { expiresAtMs: number }>();
  // Bounded temporary storage. Exhaustion holds admission; it does not evict a
  // live bucket or silently renew someone's budget. Host sizing remains a gate.
  const bucketCapacity = limits.openReports * 2;

  function observe() {
    if (!contextKnown) return held("invalid_context");
    if (observingClock) return held("invalid_clock");
    observingClock = true;
    try {
      const now = instant.parse(clock());
      if (!contextKnown) return held("invalid_context");
      if (now < lastNow || accepted.some(value => value > now)) return held("invalid_clock");
      lastNow = now;
      for (const reservation of reservations.values()) if (reservation.admittedAtMs !== null &&
          now >= reservation.admittedAtMs + limits.recordLifetimeMs) {
        reservation.admittedAtMs = null;
      }
      accepted = accepted.filter(value => value > now - limits.globalWindowMs);
      for (const [token, report] of acceptedReports) {
        if (now >= report.expiresAtMs) { acceptedReports.delete(token); open--; }
      }
      for (const [key, bucket] of buckets) {
        if (now >= bucket.expiresAtMs) buckets.delete(key);
        else bucket.attempts = bucket.attempts.filter(value => value > now - limits.addressWindowMs);
      }
      return { kind: "observed" as const, now };
    } catch { return held("invalid_clock"); }
    finally { observingClock = false; }
  }
  function finish(token: unknown, outcome: unknown, recovering: boolean) {
    const observed = observe();
    if (observed.kind === "held") return observed;
    if (typeof token !== "object" || token === null) return held("invalid_context");
    const reservation = reservations.get(token);
    if (!reservation || reservation.state !== (recovering ? "unknown" : "pending") ||
        outcome !== "not_written" && outcome !== "accepted" && outcome !== "unknown" ||
        recovering && outcome === "unknown") return held("invalid_context");
    if (outcome === "unknown") {
      reservation.state = "unknown";
      return { kind: "uncertain" as const };
    }
    reservation.state = "settled";
    reservations.delete(token);
    if (outcome === "not_written") return { kind: "released" as const };
    // The host must have independently observed an actual successful write.
    // This fixture settlement accounts for a result; it proves no delivery.
    accepted.push(observed.now);
    const report = Object.freeze({});
    const expiresAtMs = reservation.admittedAtMs === null ? null :
      reservation.admittedAtMs + limits.recordLifetimeMs;
    // A later observation cannot renew this model's admission-bound reference.
    // Real open-report reconciliation must use the separately trusted records.
    // Retirement drops the original time but preserves the opaque token's
    // pending/unknown state. An explicit trusted known outcome can still settle
    // that debt once; it cannot recreate an admission-bound report capability.
    if (expiresAtMs !== null && observed.now < expiresAtMs) {
      acceptedReports.set(report, { expiresAtMs }); open++;
    }
    return { kind: "counted_accepted" as const, report };
  }
  function begin(input: unknown, originalAdmittedAtMs: number | null = null) {
    let request: z.infer<typeof inputSchema>;
    try { request = inputSchema.parse(input); } catch { return held("invalid_context"); }
    const observed = observe();
    if (observed.kind === "held") return observed;
    // A verified invented original handoff can only shorten this budget's
    // reference bound. Address/hour accounting still uses the current clock.
    const admittedAtMs = originalAdmittedAtMs ?? observed.now;
    if (admittedAtMs > observed.now || observed.now >= admittedAtMs + limits.recordLifetimeMs) return held("invalid_context");
    const epoch = Math.floor(observed.now / limits.addressWindowMs);
    if (request.epoch !== epoch) return held("invalid_context");
    const current = buckets.get(request.currentKey), previous = buckets.get(request.previousKey);
    if (current && current.epoch !== epoch || previous && previous.epoch !== epoch - 1) return held("invalid_context");
    if (!current && buckets.size >= bucketCapacity) return held("capacity");
    const bucket = current ?? { epoch, expiresAtMs: (epoch + 2) * limits.addressWindowMs, attempts: [] };
    const attempts = bucket.attempts.length + (previous?.attempts.length ?? 0);
    if (attempts >= limits.attemptsPerAddress) return held("address_limit");
    bucket.attempts.push(observed.now);
    buckets.set(request.currentKey, bucket);
    if (request.bodyBytes > limits.bodyBytes) return held("body_limit");
    if ([...reservations.values()].some(value => value.state === "unknown" ||
        value.admittedAtMs === null)) return held("uncertain");
    if (reservations.size >= limits.concurrentAdmissions) return held("busy");
    if (accepted.length + reservations.size >= limits.acceptedPerHour) return held("global_limit");
    if (open + reservations.size >= limits.openReports) return held("open_limit");
    const token = Object.freeze({});
    reservations.set(token, { state: "pending", admittedAtMs });
    return { kind: "reserved" as const, token };
  }
  const writer = Object.freeze({
    begin(input: unknown) { return begin(input); },
    beginWithOriginalAdmissionForTrial(input: unknown, originalAdmittedAtMs: unknown) {
      // Trusted invented coordination only; no transport/issuer/SQL authority is
      // established by this scalar. The owning A handoff verifies provenance.
      const parsed = instant.safeParse(originalAdmittedAtMs);
      return parsed.success ? begin(input, parsed.data) : held("invalid_context");
    },
    settle(token: unknown, outcome: unknown) { return finish(token, outcome, false); },
  });
  const recovery = Object.freeze({
    resolve(token: unknown, outcome: unknown) { return finish(token, outcome, true); },
    invalidateForTrial() {
      contextKnown = false;
      // Permanent hold needs opaque debt/cardinality, not keyed addresses or
      // original report/admission timelines. No budget refund or reopen follows.
      buckets.clear(); accepted = []; acceptedReports.clear();
      for (const reservation of reservations.values()) {
        reservation.admittedAtMs = null; reservation.state = "unknown";
      }
      return { kind: "unknown_for_trial" as const };
    },
  });
  const reviewer = Object.freeze({
    closeCountedReport(token: unknown) {
      const observed = observe();
      if (observed.kind === "held") return observed;
      if (typeof token !== "object" || token === null) return held("invalid_context");
      const report = acceptedReports.get(token);
      if (!report) return held("invalid_context");
      acceptedReports.delete(token); open--;
      return { kind: "counted_closed" as const };
    },
  });
  const inspection = Object.freeze({
    counts() {
      const observed = observe();
      return observed.kind === "held" ? observed : { kind: "counts" as const,
        acceptedInHour: accepted.length, openReports: open, reserved: reservations.size,
        unknown: [...reservations.values()].filter(value => value.state === "unknown").length,
        addressBuckets: buckets.size };
    },
  });
  return { kind: "ready" as const, writer, recovery, reviewer, inspection };
}
