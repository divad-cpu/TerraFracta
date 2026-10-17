import type { PublicIssueProjection } from "./public-issue-projection.ts";

type Claim = PublicIssueProjection["claims"][number];
export function issueReferenceAnchor(claimId: string, referenceIndex: number) {
  return `reference-${claimId}-${referenceIndex + 1}`;
}
export function issueSourceGroupAnchor(groupIndex: number) {
  return `recorded-source-group-${groupIndex + 1}`;
}
type IndexedReference = { claim: Claim; source: Claim["evidence"][number]; anchor: string; referenceNumber: number };

// Presentation grouping of the caller's checked current projection. Identity is
// an exact source-version UUID, never a URL/publisher or inferred independent origin.
// UUID letter case cannot create another version; keep every supplied spelling
// and metadata on its original reference, with the first spelling on the group.
// Keep each reference's metadata instead of selecting one representative title.
export function issueSourceIndex(issue: PublicIssueProjection) {
  const versions = new Map<string, { sourceVersionId: string; references: IndexedReference[] }>();
  let referenceNumber = 0;
  for (const claim of issue.claims) claim.evidence.forEach((source, index) => {
    const identity = source.sourceVersionId.toLowerCase();
    let version = versions.get(identity);
    if (!version) {
      version = { sourceVersionId: source.sourceVersionId, references: [] };
      versions.set(identity, version);
    }
    version.references.push({ claim, source, anchor: issueReferenceAnchor(claim.id, index), referenceNumber: ++referenceNumber });
  });
  const groups = [...versions.values()].map(version => ({ ...version,
    statementCount: new Set(version.references.map(reference => reference.claim.id)).size,
  }));
  return { referenceCount: groups.reduce((sum, group) => sum + group.references.length, 0), groups };
}
