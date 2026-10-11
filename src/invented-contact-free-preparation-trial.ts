import { z } from "zod";
import type { PublicReadOutcome } from "./public-read-outcome.ts";
import { createInventedContactFreeAdmission } from "./invented-contact-free-admission.ts";
import { createInventedContactFreeBodyReader } from "./invented-contact-free-body-reader.ts";

const identity = z.strictObject({ currentKey: z.uuid().regex(/^[0-9a-f-]+$/),
  previousKey: z.uuid().regex(/^[0-9a-f-]+$/), epoch: z.number().int().nonnegative().safe() });

// Combines the two already separate process-local controls using invented
// identities only. Attempts/quota are reserved BEFORE native body access.
// There is deliberately no writer, acceptance settlement or recovery receipt.
export function createInventedContactFreePreparationTrial(fixture: unknown,
  admissionClock: () => unknown, observationClock: () => number = () => performance.now()) {
  const admission = createInventedContactFreeAdmission(fixture, admissionClock);
  if (admission.kind !== "ready") return { kind: "held" as const };
  const body = createInventedContactFreeBodyReader("fresh_invented_trial", observationClock);
  let contextKnown = true;
  const loseContext = () => { contextKnown = false; body.loseContext(); admission.recovery.invalidateForTrial(); };
  return Object.freeze({ kind: "ready" as const,
    async prepare(request: Request, identifiers: unknown, current: () => PublicReadOutcome) {
      let selected: z.infer<typeof identity>;
      try { selected = identity.parse(identifiers); } catch { return { kind: "held" as const }; }
      // Zero is a pre-read lower bound, not an observed body size. Only the
      // bounded reader may establish actual bytes and a checked private request.
      const reservation = admission.writer.begin({ ...selected, bodyBytes: 0 });
      if (reservation.kind !== "reserved") return { kind: "held" as const };
      try {
        const outcome = await body.prepare(request, current);
        if (body.inspection().held) loseContext();
        // No code in this trial performs a write. This nonwrite settlement is
        // known independently of transport cleanup, which retains its own slot.
        const released = admission.writer.settle(reservation.token, "not_written");
        if (released.kind !== "released") { loseContext(); return { kind: "held" as const }; }
        const aborted = request.signal.aborted;
        if (!contextKnown || body.inspection().held || outcome.kind !== "prepared" || aborted) return { kind: "held" as const };
        return { kind: "prepared_without_write" as const, bodyBytes: outcome.bodyBytes, request: outcome.request };
      } catch {
        // Unexpected infrastructure/context loss cannot renew a pending budget.
        loseContext();
        return { kind: "held" as const };
      }
    }, loseContext,
    inspection: Object.freeze({ body: body.inspection, budget: admission.inspection.counts }),
  });
}
