import { z } from "zod";
import type { PublicReadOutcome } from "./public-read-outcome.ts";
import type { CorrectionRequest } from "./correction-request.ts";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";
import { createInventedContactFreeBodyHandoff } from "./invented-contact-free-body-handoff.ts";
import { createInventedContactFreeWriteTrial } from "./invented-contact-free-write-trial.ts";
import { observeInventedContactFreeClock } from "./invented-contact-free-clock.ts";
import { checkInventedContactFreeWriteObservation, type InventedWriteIdentity } from "./contact-free-write-observation.ts";

const id = z.uuid().regex(/^[0-9a-f-]+$/);
const instant = z.number().int().safe().nonnegative().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const keysSchema = z.strictObject({ currentKey: id, previousKey: id, epoch: z.number().int().safe().nonnegative() });
const reservedSchema = z.strictObject({ kind: z.literal("reserved_invented"), ticket: id,
  operationId: id, admittedAtMs: instant });
const heldSchema = z.strictObject({ kind: z.literal("held") });
const armedSchema = z.strictObject({ kind: z.literal("armed_invented"), operationId: id, admittedAtMs: instant });
const releasedSchema = z.strictObject({ kind: z.literal("released_invented") });
const held = () => ({ kind: "held" as const });
const nativeNow = performance.now.bind(performance);
const nativeId = crypto.randomUUID.bind(crypto);
type Reservation = z.infer<typeof reservedSchema>;
type Result = { kind: "held" } | { kind: "recorded_invented"; receipt: unknown } | { kind: "released_prewrite_invented" };
type Operation = { token: object; operationId: string | null; startAtMs: number | null; reservation: Reservation | null;
  phase: "reserving" | "reading" | "writing" | "unknown"; physical: number; observer: boolean;
  bodyTicket: object | null; bodyRetired: boolean; reserveAttempted: boolean; identity: InventedWriteIdentity | null; armCalled: boolean };
export type InventedSharedWritePorts = Readonly<{ executionId: string;
  reserve: (input: Readonly<{ executionId: string; operationId: string; currentKey: string; previousKey: string; epoch: number }>, signal: AbortSignal) => Promise<unknown>;
  arm: (input: Readonly<{ executionId: string; ticket: string; requestId: string; target: CorrectionRequest["draft"]["target"] }>, signal: AbortSignal) => Promise<unknown>;
  write: (input: Readonly<{ executionId: string; ticket: string; request: CorrectionRequest }>, signal: AbortSignal) => Promise<unknown>;
  release: (input: Readonly<{ executionId: string; ticket: string }>, signal: AbortSignal) => Promise<unknown>;
  resolve: (input: Readonly<{ executionId: string; ticket: string }>, signal: AbortSignal) => Promise<unknown>;
}>;

// One invented orchestration path over E-compatible trusted fixture ports.
// A/I remain the physical owners; E owns durable budgets and operation outcomes.
// This is no real adapter, handler, principal/proxy proof or restart credential.
export function createInventedContactFreeSharedWriteTrial(ports: InventedSharedWritePorts, clock: unknown) {
  const created = createInventedContactFreeBodyHandoff(clock);
  if (created.kind !== "ready") return held();
  const body = created;
  let executionId: string, reserve: InventedSharedWritePorts["reserve"], arm: InventedSharedWritePorts["arm"];
  let write: InventedSharedWritePorts["write"], release: InventedSharedWritePorts["release"], resolve: InventedSharedWritePorts["resolve"];
  try {
    executionId = id.parse(ports.executionId); reserve = ports.reserve; arm = ports.arm;
    write = ports.write; release = ports.release; resolve = ports.resolve;
    if ([reserve, arm, write, release, resolve].some(value => typeof value !== "function")) return held();
  } catch { return held(); }
  const operations = new Map<object, Operation>();
  let known = true, starting = false;
  function loseContext() { known = false; body.loseContext(); core?.loseContext(); return held(); }
  function snapshot() {
    const at = observeInventedContactFreeClock(clock);
    // A known issued clock can remove owned metadata even after permanent
    // hold. Expiry retains opaque debt and cannot make admission eligible.
    for (const operation of operations.values()) if (at.kind === "observed" && operation.startAtMs !== null && at.utcAtMs >= operation.startAtMs + limits.recordLifetimeMs) {
      operation.operationId = null; operation.reservation = null; operation.identity = null; operation.startAtMs = null;
      operation.phase = "unknown";
    }
    if (!known || at.kind !== "observed" || body.inspection().held || core?.inspection.operations().held) { loseContext(); return null; }
    return at;
  }
  let core: Extract<ReturnType<typeof createInventedContactFreeWriteTrial>, { kind: "ready" }> | undefined;
  const built = createInventedContactFreeWriteTrial({ kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, {
    executionId, nextOperationId: () => { throw Error("Issued admission required"); },
    async write(input, signal, mayDispatchNextForTrial) {
      const operation = [...operations.values()].find(value => value.operationId === input.operationId);
      if (operation === undefined || operation.reservation === null || !operation.bodyRetired ||
          input.admittedAtMs !== operation.reservation.admittedAtMs || snapshot() === null) throw Error("Invented operation held");
      operation.identity = Object.freeze({ executionId, operationId: input.operationId,
        requestId: input.request.requestId, target: input.request.draft.target, admittedAtMs: input.admittedAtMs });
      operation.phase = "writing"; operation.armCalled = true; operation.physical++;
      try {
        const raw = await arm(Object.freeze({ executionId, ticket: operation.reservation.ticket,
          requestId: input.request.requestId, target: input.request.draft.target }), signal);
        const armed = armedSchema.parse(raw);
        const aborted = signal.aborted;
        // Use A's original deadline after the last foreign signal getter, before
        // any prepared private packet crosses the subsequent actual write port.
        const at = snapshot();
        if (at === null || aborted || operation.reservation === null || armed.operationId !== input.operationId ||
            armed.admittedAtMs !== input.admittedAtMs || at.utcAtMs >= input.admittedAtMs + limits.payloadLifetimeMs) throw Error("Invented arm held");
        if (!mayDispatchNextForTrial()) throw Error("Invented original write observation held");
        return await write(Object.freeze({ executionId, ticket: operation.reservation.ticket, request: input.request }), signal);
      } finally { operation.physical--; }
    },
    recover: async () => { throw Error("Only shared durable resolution is permitted"); },
  }, clock);
  if (built.kind !== "ready") return held(); core = built;

  // Reserve/release/resolve observers retire independently of the owned port.
  // Parent/timeout never kills it or manufactures absence from a missing reply.
  function observe<T>(operation: Operation, request: Request | null,
    task: (signal: AbortSignal) => Promise<unknown>, check: (value: unknown) => T): Promise<{ kind: "observed"; value: T } | { kind: "held" }> {
    let deliver!: (value: { kind: "observed"; value: T } | { kind: "held" }) => void;
    const promise = new Promise<{ kind: "observed"; value: T } | { kind: "held" }>(resolve => { deliver = resolve; });
    const controller = new AbortController();
    let stopped = false, attached = false, timer: ReturnType<typeof setTimeout> | undefined;
    const start = snapshot(), nativeStart = nativeNow();
    operation.observer = true; operation.physical++;
    function interrupt() { if (stopped) return; stopped = true; operation.phase = "unknown"; controller.abort(); deliver(held()); }
    function live() {
      try {
        const aborted = request?.signal.aborted ?? false, at = snapshot();
        return !stopped && !aborted && start !== null && at !== null &&
          operation.operationId !== null && operation.startAtMs !== null && at.utcAtMs < operation.startAtMs +
            (request === null ? limits.recordLifetimeMs : limits.payloadLifetimeMs) &&
          at.observationAtMs - start.observationAtMs < 2_000 && nativeNow() - nativeStart < 2_000;
      } catch { loseContext(); return false; }
    }
    function cleanup() {
      operation.observer = false;
      try { if (timer !== undefined) clearTimeout(timer); if (attached) request!.signal.removeEventListener("abort", interrupt); }
      catch { loseContext(); }
    }
    void (async () => {
      try {
        if (request !== null) { attached = true; request.signal.addEventListener("abort", interrupt, { once: true }); }
        timer = setTimeout(interrupt, 2_000);
        if (!live()) { interrupt(); return; }
        const raw = await task(controller.signal);
        const value = check(raw); // Detached metadata only; late reserve proof may be retained.
        if (!live()) { interrupt(); return; }
        cleanup();
        if (!live()) { interrupt(); return; }
        deliver({ kind: "observed", value });
      } catch { operation.phase = "unknown"; deliver(held()); }
      finally { cleanup(); operation.physical--; }
    })();
    return promise;
  }
  function readyForPrewrite(operation: Operation) {
    if (snapshot() === null || operation.physical !== 0 || operation.observer || operation.armCalled || operation.reservation === null) return false;
    if (!operation.bodyRetired && operation.bodyTicket !== null) {
      const retired = body.retire(operation.bodyTicket);
      if (retired.kind !== "physically_retired_invented_body" || !retired.contextKnown) return false;
      operation.bodyTicket = null; operation.bodyRetired = true;
    }
    return operation.bodyRetired || operation.bodyTicket === null && operation.phase === "unknown";
  }
  async function retirePrewrite(token: unknown): Promise<Result> {
    const operation = typeof token === "object" && token !== null ? operations.get(token) : undefined;
    if (operation === undefined || !readyForPrewrite(operation)) return held();
    const ticket = operation.reservation!.ticket;
    const observed = await observe(operation, null, signal => release(Object.freeze({ executionId, ticket }), signal), raw => releasedSchema.parse(raw));
    if (observed.kind !== "observed" || snapshot() === null) return held();
    operations.delete(operation.token); return { kind: "released_prewrite_invented" };
  }
  return Object.freeze({ kind: "ready" as const,
    begin(request: Request, keysInput: unknown, current: () => PublicReadOutcome) {
      if (starting || snapshot() === null || operations.size >= limits.concurrentAdmissions ||
          [...operations.values()].some(value => value.phase === "unknown" || value.phase === "writing")) return held();
      starting = true;
      try {
        const at = snapshot(); if (at === null) return held();
        const token = Object.freeze({});
        const operation: Operation = { token, operationId: nativeId(), startAtMs: at.utcAtMs, reservation: null,
          phase: "reserving", physical: 0, observer: false, bodyTicket: null, bodyRetired: false, reserveAttempted: false, identity: null, armCalled: false };
        operations.set(token, operation);
        let keys: z.infer<typeof keysSchema>;
        try { keys = keysSchema.parse(keysInput); } catch { operations.delete(token); return held(); }
        const observation = (async (): Promise<Result> => {
          const reserved = await observe(operation, request,
            signal => { operation.reserveAttempted = true; return reserve(Object.freeze({ executionId, operationId: operation.operationId!, ...keys }), signal); }, raw => {
              if (heldSchema.safeParse(raw).success) return held();
              const value = reservedSchema.parse(raw), now = snapshot();
              if (now === null || operation.startAtMs === null || value.operationId !== operation.operationId || value.admittedAtMs < operation.startAtMs || value.admittedAtMs > now.utcAtMs) throw Error("Invented admission differs");
              operation.reservation = Object.freeze(value); operation.startAtMs = value.admittedAtMs; return value;
            });
          if (reserved.kind !== "observed") {
            if (!operation.reserveAttempted) operations.delete(token); // Own known nonwrite; no port/body was called.
            return held();
          }
          if (reserved.value.kind === "held") { operations.delete(token); return held(); }
          if (snapshot() === null) return held();
          operation.phase = "reading";
          const owned = body.begin(request, current, { kind: "invented_shared_admission", executionId,
            operationId: reserved.value.operationId, admittedAtMs: reserved.value.admittedAtMs });
          if (owned.kind !== "owned_invented_handoff") { operation.phase = "unknown"; return held(); }
          operation.bodyTicket = owned.ticket;
          const prepared = await owned.observation;
          if (prepared.kind !== "prepared_invented_handoff") { operation.phase = "unknown"; return held(); }
          operation.bodyTicket = null; operation.bodyRetired = true;
          const result = await core!.submitPreparedForTrial(prepared.token, keys);
          operation.phase = "unknown";
          return result.kind === "recorded_invented" ? result : held();
        })().catch(() => { operation.phase = "unknown"; return held(); });
        return Object.freeze({ kind: "owned_invented_submission" as const, token, observation });
      } finally { starting = false; }
    }, retirePrewrite, loseContext,
    async resolveUnknown(token: unknown): Promise<Result> {
      const operation = typeof token === "object" && token !== null ? operations.get(token) : undefined;
      if (operation === undefined || snapshot() === null || operation.phase !== "unknown" || operation.physical !== 0 ||
          operation.observer || !operation.bodyRetired || !operation.armCalled || operation.reservation === null || operation.identity === null ||
          core!.inspection.operations().physical !== 0) return held();
      const identity = operation.identity, ticket = operation.reservation.ticket;
      const observed = await observe(operation, null, signal => resolve(Object.freeze({ executionId, ticket }), signal), raw => {
        const at = snapshot(); if (at === null) throw Error("Invented resolution held");
        const checked = checkInventedContactFreeWriteObservation(raw, identity, at.utcAtMs);
        if (checked.kind !== "confirmed" && checked.kind !== "known_nonwrite") throw Error("Invented resolution unknown");
        return checked;
      });
      if (observed.kind !== "observed" || snapshot() === null) return held();
      operations.delete(operation.token);
      // Core's process-local unknown cannot be renewed into fresh authority.
      // This factory deliberately remains held after shared metadata settlement.
      loseContext();
      return observed.value.kind === "confirmed" ? { kind: "recorded_invented", receipt: observed.value.receipt } : held();
    },
    inspection: () => {
      snapshot(); const bodyState = body.inspection();
      return Object.freeze({ held: !known, owned: operations.size,
        physicalPorts: [...operations.values()].reduce((sum, value) => sum + value.physical, 0),
        physicalBodies: bodyState.physicalReads, ownedBodyLeases: bodyState.ownedLeases,
        preparedBodyHandoffs: bodyState.preparedHandoffs, physicalWrites: core!.inspection.operations().physical,
        unknown: [...operations.values()].filter(value => value.phase === "unknown").length });
    },
  });
}
