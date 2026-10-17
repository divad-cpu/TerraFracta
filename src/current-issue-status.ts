import { z } from "zod";
import { readStatusResponse } from "./status-response.ts";
import { publicIssueProjectionSchema, type PublicIssueProjection } from "./public-issue-projection.ts";
import type { PublicReadResponseDecision } from "./public-read-response.ts";

const identitySchema = publicIssueProjectionSchema.pick({ jurisdictionSlug: true, issueSlug: true, issueId: true, publicationId: true, revision: true });
const schema = z.discriminatedUnion("kind", [
  identitySchema.extend({ schemaVersion: z.literal(1), kind: z.literal("current") }).strict(),
  z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("absent") }),
  z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("unavailable") }),
]);
export type CurrentIssueIdentity = z.infer<typeof identitySchema>;
export type CurrentIssueVerdict = { kind: "current" } | { kind: "changed" } | { kind: "absent" } | { kind: "unavailable" };

// One closed identity snapshot; parsing does not qualify a publication or source.
export function captureCurrentIssueIdentity(input: unknown): Readonly<CurrentIssueIdentity> | null {
  try {
    const parsed = identitySchema.safeParse(input);
    return parsed.success ? Object.freeze(parsed.data) : null;
  } catch { return null; }
}

export function currentIssueIdentity(issue: PublicIssueProjection): CurrentIssueIdentity {
  return identitySchema.parse({ jurisdictionSlug: issue.jurisdictionSlug, issueSlug: issue.issueSlug,
    issueId: issue.issueId, publicationId: issue.publicationId, revision: issue.revision });
}
export function currentIssueStatusPayload(decision: PublicReadResponseDecision) {
  if (decision.status === 404) return { schemaVersion: 1 as const, kind: "absent" as const };
  if (decision.status !== 200) return { schemaVersion: 1 as const, kind: "unavailable" as const };
  return { schemaVersion: 1 as const, kind: "current" as const, ...currentIssueIdentity(decision.issue) };
}
export function interpretCurrentIssueStatus(input: unknown, expected: CurrentIssueIdentity): CurrentIssueVerdict {
  const identity = captureCurrentIssueIdentity(expected);
  if (identity === null) return { kind: "unavailable" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { kind: "unavailable" };
  if (parsed.data.kind !== "current") return { kind: parsed.data.kind };
  const value = parsed.data;
  if (value.jurisdictionSlug !== identity.jurisdictionSlug || value.issueSlug !== identity.issueSlug || value.issueId.toLowerCase() !== identity.issueId.toLowerCase()) return { kind: "unavailable" };
  // Compare parsed UUID values while preserving every captured field's spelling.
  const samePublication = value.publicationId.toLowerCase() === identity.publicationId.toLowerCase();
  if (samePublication && value.revision === identity.revision) return { kind: "current" };
  return value.revision > identity.revision && !samePublication ? { kind: "changed" } : { kind: "unavailable" };
}

export async function requestCurrentIssueStatus(expected: CurrentIssueIdentity, signal: AbortSignal, send: typeof fetch = fetch): Promise<unknown> {
  const identity = identitySchema.parse(expected);
  if (signal.aborted) throw new Error("Current issue unavailable");
  const response = await send(`/api/dev/current-issue-status/${identity.jurisdictionSlug}/${identity.issueSlug}`,
    { cache: "no-store", credentials: "omit", signal });
  return readStatusResponse(response, signal);
}
