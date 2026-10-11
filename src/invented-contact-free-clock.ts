import { z } from "zod";
import { contactFreeCorrectionPolicy as limits } from "./contact-free-correction-policy.ts";

// One owned invented UTC/monotonic snapshot. Opaque process provenance is not
// host authentication, durable continuity or a real database clock provider.
// UTC is fixed/manual fixture time; monotonic elapsed uses the captured native
// clock plus explicit trial-only advances. No caller callback runs on observe.
const nativeNow = performance.now.bind(performance);
const instant = z.number().int().nonnegative().safe().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs);
const fixtureSchema = z.strictObject({ kind: z.literal("fresh_invented_clock"), utcAtMs: instant });
const advanceSchema = z.strictObject({ utcAtMs: instant.optional(),
  observationDeltaMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs).optional(),
}).refine(value => value.utcAtMs !== undefined || value.observationDeltaMs !== undefined);
type State = { utc: number; offset: number; origin: number; lastMono: number; known: boolean; advancing: boolean };
const issued = new WeakMap<object, State>();
const held = () => ({ kind: "held" as const });

export function observeInventedContactFreeClock(token: unknown) {
  const state = typeof token === "object" && token !== null ? issued.get(token) : undefined;
  if (!state?.known || state.advancing) return held();
  const mono = nativeNow() - state.origin + state.offset;
  if (!Number.isFinite(mono) || mono < 0 || mono < state.lastMono || mono > Number.MAX_SAFE_INTEGER) {
    state.known = false; return held();
  }
  state.lastMono = mono;
  return Object.freeze({ kind: "observed" as const, utcAtMs: state.utc, observationAtMs: mono });
}

export function createInventedContactFreeClock(input: unknown) {
  let utc: number;
  try { utc = fixtureSchema.parse(input).utcAtMs; } catch { return held(); }
  const token = Object.freeze({});
  const state: State = { utc, offset: 0, origin: nativeNow(), lastMono: 0, known: true, advancing: false };
  issued.set(token, state);
  return Object.freeze({ kind: "ready" as const, token,
    advanceForTrial(input: unknown) {
      if (!state.known || state.advancing) { state.known = false; return held(); }
      state.advancing = true;
      try {
        const value = advanceSchema.parse(input);
        if (!state.known || value.utcAtMs !== undefined && value.utcAtMs < state.utc ||
            state.offset + (value.observationDeltaMs ?? 0) > Number.MAX_SAFE_INTEGER - limits.recordLifetimeMs) {
          state.known = false; return held();
        }
        // Parsed numbers are detached before the atomic owned transition.
        state.utc = value.utcAtMs ?? state.utc; state.offset += value.observationDeltaMs ?? 0;
        return { kind: "advanced_invented" as const };
      } catch { state.known = false; return held(); }
      finally { state.advancing = false; }
    },
    loseContextForTrial() { state.known = false; return held(); },
    inspection: () => observeInventedContactFreeClock(token),
  });
}
