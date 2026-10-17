import { z } from "zod";
import type { ConnectedReaderOutcome, ConnectedReaderSnapshot } from "./connected-fictional-reader.ts";

const generation = z.number().int().min(1).max(128);
const current = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("current"), generation,
  executionId: z.uuid({ version: "v4" }), observedAt: z.iso.datetime({ offset: true }),
  state: z.enum(["active", "suppressed"]), publicationId: z.uuid().nullable(),
});
const identitySchema = current.omit({ schemaVersion: true, kind: true });
const changed = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("changed"), currentGeneration: generation });
const unavailable = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("unavailable") });
const schema = z.discriminatedUnion("kind", [current, changed, unavailable]);
export type ConnectedStatusIdentity = Pick<ConnectedReaderSnapshot, "generation" | "executionId" | "observedAt" | "state"> & { publicationId: string | null };
export type ConnectedStatusVerdict = { kind: "current" } | { kind: "changed"; currentGeneration: number } | { kind: "unavailable" };

export function captureConnectedStatusIdentity(input: unknown): Readonly<ConnectedStatusIdentity> | null {
  try {
    const parsed = identitySchema.safeParse(input);
    return parsed.success ? Object.freeze(parsed.data) : null;
  } catch { return null; }
}

export function connectedStatusIdentity(snapshot: ConnectedReaderSnapshot): ConnectedStatusIdentity {
  return { generation: snapshot.generation, executionId: snapshot.executionId, observedAt: snapshot.observedAt,
    state: snapshot.state, publicationId: snapshot.state === "active" ? snapshot.issue.publicationId : null };
}
export function connectedStatusPayload(outcome: ConnectedReaderOutcome) {
  if (outcome.kind === "snapshot") return { schemaVersion: 1 as const, kind: "current" as const, ...connectedStatusIdentity(outcome.snapshot) };
  if (outcome.kind === "changed") return { schemaVersion: 1 as const, kind: "changed" as const, currentGeneration: outcome.currentGeneration };
  return { schemaVersion: 1 as const, kind: "unavailable" as const };
}
export function interpretConnectedStatus(input: unknown, expected: ConnectedStatusIdentity): ConnectedStatusVerdict {
  const identity = captureConnectedStatusIdentity(expected);
  if (identity === null) return { kind: "unavailable" };
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data.kind === "unavailable") return { kind: "unavailable" };
  const p = parsed.data;
  if (p.kind === "changed") return p.currentGeneration > identity.generation ? { kind: "changed", currentGeneration: p.currentGeneration } : { kind: "unavailable" };
  const samePublication = p.publicationId === null ? identity.publicationId === null
    : identity.publicationId !== null && p.publicationId.toLowerCase() === identity.publicationId.toLowerCase();
  if (p.generation !== identity.generation || p.executionId.toLowerCase() !== identity.executionId.toLowerCase() || p.observedAt !== identity.observedAt ||
      p.state !== identity.state || !samePublication) return { kind: "unavailable" };
  return { kind: "current" };
}
