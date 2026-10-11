import { z } from "zod";
import type { PublicReadOutcome } from "./public-read-outcome.ts";
import type { CorrectionRequest } from "./correction-request.ts";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";
import { createInventedContactFreeBodyOwnership } from "./invented-contact-free-body-ownership.ts";
import { observeInventedContactFreeClock } from "./invented-contact-free-clock.ts";

// An issued process-local handoff is evidence of this reader's own retirement,
// never SQL admission/authentication, nonwrite, host continuity or restart trust.
const id = z.uuid().regex(/^[0-9a-f-]+$/);
const admissionSchema = z.strictObject({ kind: z.literal("invented_shared_admission"),
  executionId: id, operationId: id, admittedAtMs: z.number().int().safe().nonnegative()
    .max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs) });
type Admission = z.infer<typeof admissionSchema>;
type Handoff = { clock: unknown; original: Request; prepared: CorrectionRequest; admission: Admission;
  start: number; valid: () => boolean; retire: () => void };
type Origin = { clock: unknown; admission: Admission; valid: () => boolean };
const issued = new WeakMap<object, Handoff>();
const origins = new WeakMap<object, Origin>();
const held = () => ({ kind: "held" as const });
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Only A consumes issued tokens; raw/cloned/cross-clock/replayed objects fail.
// Claim removes the private packet from the issuer before returning it to A.
export function claimInventedContactFreeBodyHandoff(token: unknown, clock: unknown) {
  const entry = typeof token === "object" && token !== null ? issued.get(token) : undefined;
  if (entry === undefined || entry.clock !== clock) return held();
  const at = observeInventedContactFreeClock(clock);
  if (at.kind !== "observed" || !entry.valid() || at.utcAtMs < entry.admission.admittedAtMs ||
      at.utcAtMs >= entry.admission.admittedAtMs + limits.payloadLifetimeMs) {
    entry.retire(); return held();
  }
  entry.retire();
  const origin = Object.freeze({});
  origins.set(origin, { clock, admission: entry.admission, valid: entry.valid });
  return Object.freeze({ kind: "claimed_invented_body" as const, origin,
    request: entry.original, prepared: entry.prepared, admission: entry.admission });
}
// Retirement removes only this issued logical entry. It never resolves SQL
// uncertainty, releases admission or proves physical memory/media erasure.
export function retireInventedContactFreeBodyOrigin(origin: unknown, clock: unknown) {
  const entry = typeof origin === "object" && origin !== null ? origins.get(origin) : undefined;
  if (entry === undefined || entry.clock !== clock) return held();
  origins.delete(origin as object);
  return { kind: "retired_invented_origin" as const };
}
export function observeInventedContactFreeBodyOrigin(origin: unknown, clock: unknown, purpose: "payload" | "metadata" = "metadata") {
  const entry = typeof origin === "object" && origin !== null ? origins.get(origin) : undefined;
  const at = observeInventedContactFreeClock(clock);
  if (entry !== undefined && entry.clock === clock && at.kind === "observed" &&
      at.utcAtMs >= entry.admission.admittedAtMs + limits.recordLifetimeMs) {
    retireInventedContactFreeBodyOrigin(origin, clock); return false;
  }
  return entry !== undefined && entry.clock === clock && at.kind === "observed" && entry.valid() &&
    at.utcAtMs >= entry.admission.admittedAtMs && at.utcAtMs < entry.admission.admittedAtMs + (purpose === "payload" ? limits.payloadLifetimeMs : limits.recordLifetimeMs);
}

export function createInventedContactFreeBodyHandoff(clock: unknown) {
  const created = createInventedContactFreeBodyOwnership(clock);
  if (created.kind !== "ready") return held();
  const owner = created;
  const leases = new WeakMap<object, object>();
  const pending = new Set<object>(), packets = new Set<object>();
  let known = true, starting = false;
  function loseContext() {
    known = false; owner.loseContext();
    for (const token of packets) issued.delete(token);
    packets.clear(); return held();
  }
  function valid() {
    const at = observeInventedContactFreeClock(clock);
    if (!known || at.kind !== "observed" || owner.inspection().held) { loseContext(); return false; }
    for (const token of packets) {
      const entry = issued.get(token);
      if (entry === undefined || at.utcAtMs >= entry.admission.admittedAtMs + limits.payloadLifetimeMs) {
        loseContext(); return false;
      }
    }
    return true;
  }
  function retire(ticket: unknown) {
    const body = typeof ticket === "object" && ticket !== null ? leases.get(ticket) : undefined;
    if (body === undefined) return held();
    const result = owner.retire(body);
    if (result.kind === "physically_retired_invented_body") { leases.delete(ticket as object); pending.delete(ticket as object); }
    if (result.kind === "physically_retired_invented_body" && !result.contextKnown) loseContext();
    return result;
  }
  function begin(request: Request, current: () => PublicReadOutcome, admissionInput: unknown) {
    if (starting || !valid() || pending.size + packets.size >= limits.concurrentAdmissions) return held();
    starting = true;
    try {
    let admission: Admission;
    try { admission = freeze(admissionSchema.parse(admissionInput)); } catch { return held(); }
    const start = observeInventedContactFreeClock(clock);
    if (start.kind !== "observed" || admission.admittedAtMs > start.utcAtMs ||
        start.utcAtMs >= admission.admittedAtMs + limits.payloadLifetimeMs) return held();
    const body = owner.begin(request, current);
    if (body.kind !== "owned_invented_body") return held();
    const ticket = Object.freeze({}); leases.set(ticket, body.token); pending.add(ticket);
    const observation = body.observation.then(value => {
      if (value.kind !== "prepared") return held();
      const retired = retire(ticket), at = observeInventedContactFreeClock(clock);
      if (retired.kind !== "physically_retired_invented_body" || !retired.contextKnown ||
          !valid() || at.kind !== "observed" || at.observationAtMs - start.observationAtMs >= 2_000 ||
          at.utcAtMs >= admission.admittedAtMs + limits.payloadLifetimeMs) return held();
      const token = Object.freeze({});
      const entry: Handoff = { clock, original: request, prepared: freeze(value.request), admission,
        start: start.observationAtMs, valid, retire: () => { issued.delete(token); packets.delete(token); } };
      packets.add(token); issued.set(token, entry);
      return Object.freeze({ kind: "prepared_invented_handoff" as const, token });
    }, () => { loseContext(); return held(); });
    return Object.freeze({ kind: "owned_invented_handoff" as const, ticket, observation });
    } finally { starting = false; }
  }
  return Object.freeze({ kind: "ready" as const, begin, retire, loseContext,
    discard(token: unknown) {
      if (typeof token !== "object" || token === null || !packets.has(token)) return held();
      issued.get(token)?.retire(); return { kind: "discarded_invented_handoff" as const };
    },
    inspection: () => {
      valid(); const body = owner.inspection();
      return Object.freeze({ held: !known, physicalReads: body.physicalReads,
        ownedLeases: pending.size, preparedHandoffs: packets.size });
    },
  });
}
