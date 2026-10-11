import { z } from "zod";

// A display contract for a future reviewed publication read path. Parsing this
// shape cannot itself approve a source or activate a database publication.
const text = (limit: number) => z.string().trim().min(1).max(limit);
const uuid = z.uuid();
const sensitiveQueryKeys = new Set([
  "api_key", "apikey", "key", "access_token", "token", "secret",
  "client_secret", "password", "auth", "authorization",
]);

// Validate raw input before Zod URL parsing can remove controls or trim it.
// The same bounded HTTPS source shape is required by the worker contracts.
export const publicSourceUrl = z.string().min(1).max(2048).refine(
  (value) => !/[\\\x00-\x1f\x7f]/.test(value),
  "A public source URL must not contain raw controls or backslashes",
).pipe(z.string().url()).pipe(z.string().refine((value) => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && url.port !== "0" && !url.username && !url.password &&
    !url.hash && ![...url.searchParams.keys()].some((key) => sensitiveQueryKeys.has(key.toLowerCase())) &&
    host.includes(".") && !host.endsWith(".") &&
    host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    host !== "localhost" && !host.endsWith(".localhost") &&
    !host.endsWith(".local") && !host.endsWith(".internal") &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(":");
}, "A public source must have a non-local HTTPS URL without credentials"));

const source = z.strictObject({
  sourceVersionId: uuid,
  publisher: text(160),
  title: text(240),
  url: publicSourceUrl,
  locator: text(300),
  relation: z.enum(["supports", "contradicts", "context"]),
  sourcePublishedOn: z.iso.date().nullable(),
  retrievedAt: z.iso.datetime({ offset: true }),
});

const claim = z.strictObject({
  id: uuid,
  type: z.enum(["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation"]),
  assertion: text(1200),
  periodLabel: text(160),
  evidence: z.array(source).min(1).max(12).refine(
    (items) => items.some((item) => item.relation === "supports"),
    "Each displayed claim needs at least one supporting locator",
  ),
});

export const publicationReadEnvelopeSchema = z.strictObject({
  currentPublicationId: uuid,
  publication: z.strictObject({
    id: uuid,
    issueId: uuid,
    revision: z.number().int().positive(),
    kind: z.enum(["accepted", "correction"]),
    snapshot: z.strictObject({
      schemaVersion: z.literal(1),
      jurisdictionSlug: text(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      issueSlug: text(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      title: text(240),
      summary: text(1600),
      lastEvidenceReviewOn: z.iso.date(),
      claims: z.array(claim).min(1).max(30),
    }),
    dependencyManifest: z.strictObject({
      sourceVersionIds: z.array(uuid).min(1).max(120),
    }),
  }),
});

export type PublicIssueProjection = {
  issueId: string;
  publicationId: string;
  revision: number;
  jurisdictionSlug: string;
  issueSlug: string;
  title: string;
  summary: string;
  lastEvidenceReviewOn: string;
  claims: z.infer<typeof claim>[];
};

// Closed display data only. This parser does not establish that the source,
// current head or decision was checked; database reads still use the materializer.
export const publicIssueProjectionSchema = z.strictObject({
  issueId: uuid, publicationId: uuid, revision: z.number().int().positive(),
  jurisdictionSlug: text(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  issueSlug: text(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: text(240), summary: text(1600), lastEvidenceReviewOn: z.iso.date(),
  claims: z.array(claim).min(1).max(30),
});

export function parsePublicIssueProjection(input: unknown): PublicIssueProjection {
  const { currentPublicationId, publication } = publicationReadEnvelopeSchema.parse(input);
  if (currentPublicationId !== publication.id) {
    throw new Error("Publication is not the current issue head");
  }

  const listed = new Set(publication.dependencyManifest.sourceVersionIds);
  if (listed.size !== publication.dependencyManifest.sourceVersionIds.length) {
    throw new Error("Duplicate source version in dependency manifest");
  }
  const cited = new Set(publication.snapshot.claims.flatMap((item) =>
    item.evidence.map((itemEvidence) => itemEvidence.sourceVersionId)));
  if (listed.size !== cited.size || [...cited].some((id) => !listed.has(id))) {
    throw new Error("Claim evidence and dependency manifest disagree");
  }
  const claimIds = publication.snapshot.claims.map((item) => item.id);
  if (new Set(claimIds).size !== claimIds.length) {
    throw new Error("Duplicate claim in publication snapshot");
  }

  const { snapshot } = publication;
  return {
    issueId: publication.issueId,
    publicationId: publication.id,
    revision: publication.revision,
    jurisdictionSlug: snapshot.jurisdictionSlug,
    issueSlug: snapshot.issueSlug,
    title: snapshot.title,
    summary: snapshot.summary,
    lastEvidenceReviewOn: snapshot.lastEvidenceReviewOn,
    claims: snapshot.claims,
  };
}
