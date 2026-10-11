import type { PublicIssueProjection } from "./public-issue-projection.ts";

type Claim = PublicIssueProjection["claims"][number];
export function issueReferenceAnchor(claimId: string, referenceIndex: number) {
  return `reference-${claimId}-${referenceIndex + 1}`;
}
type IndexedReference = { claim: Claim; source: Claim["evidence"][number]; anchor: string; referenceNumber: number };

// Presentation grouping of the caller's checked current projection. Identity is
// an exact source version, never a URL/publisher or inferred independent origin.
// Keep each reference's metadata instead of selecting one representative title.
export function issueSourceIndex(issue: PublicIssueProjection) {
  const versions = new Map<string, { sourceVersionId: string; references: IndexedReference[] }>();
  let referenceNumber = 0;
  for (const claim of issue.claims) claim.evidence.forEach((source, index) => {
    let version = versions.get(source.sourceVersionId);
    if (!version) {
      version = { sourceVersionId: source.sourceVersionId, references: [] };
      versions.set(source.sourceVersionId, version);
    }
    version.references.push({ claim, source, anchor: issueReferenceAnchor(claim.id, index), referenceNumber: ++referenceNumber });
  });
  const groups = [...versions.values()].map(version => ({ ...version,
    statementCount: new Set(version.references.map(reference => reference.claim.id)).size,
  }));
  return { referenceCount: groups.reduce((sum, group) => sum + group.references.length, 0), groups };
}
