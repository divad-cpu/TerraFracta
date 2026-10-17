import { canonicalProposalJson, type ProposalCapturePayload } from "./operator-proposal-capture.ts";

type Snapshot = ProposalCapturePayload["snapshot"];
type Claim = Snapshot["claims"][number];
const snapshotFields = ["title", "summary", "lastEvidenceReviewOn"] as const;
const claimFields = ["type", "assertion", "periodLabel", "evidence"] as const;

export type RecordedProposalChanges = {
  baseAbsent: boolean;
  snapshotFields: (typeof snapshotFields[number])[];
  statementOrderChanged: boolean;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  statements: {
    id: string;
    kind: "added" | "removed" | "changed";
    fields: (typeof claimFields[number])[];
    before: Claim | null;
    after: Claim | null;
    beforeIndex: number | null;
    afterIndex: number | null;
  }[];
};

// Compare already validated recorded snapshots. Identity is the exact claim ID;
// wording similarity is not identity, and equality does not qualify evidence.
// UUID case is another spelling of that identity. Retain original side objects
// and spelling; every compared field and reference value stays exact.
export function compareRecordedProposalSnapshots(base: Snapshot | null, proposed: Snapshot): RecordedProposalChanges {
  const before = new Map(base?.claims.map((claim, index) => [claim.id.toLowerCase(), { claim, index }]));
  const afterIds = new Set(proposed.claims.map(claim => claim.id.toLowerCase()));
  const statements: RecordedProposalChanges["statements"] = [];
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const [index, claim] of proposed.claims.entries()) {
    const previous = before.get(claim.id.toLowerCase());
    if (!previous) {
      counts.added++;
      statements.push({ id: claim.id, kind: "added", fields: [], before: null, after: claim, beforeIndex: null, afterIndex: index });
      continue;
    }
    const fields = claimFields.filter(field => field === "evidence"
      ? canonicalProposalJson(previous.claim.evidence) !== canonicalProposalJson(claim.evidence)
      : previous.claim[field] !== claim[field]);
    if (fields.length) {
      counts.changed++;
      statements.push({ id: claim.id, kind: "changed", fields, before: previous.claim, after: claim, beforeIndex: previous.index, afterIndex: index });
    } else counts.unchanged++;
  }
  for (const [index, claim] of (base?.claims ?? []).entries()) {
    if (!afterIds.has(claim.id.toLowerCase())) {
      counts.removed++;
      statements.push({ id: claim.id, kind: "removed", fields: [], before: claim, after: null, beforeIndex: index, afterIndex: null });
    }
  }
  return {
    baseAbsent: base === null,
    snapshotFields: base === null ? [] : snapshotFields.filter(field => base[field] !== proposed[field]),
    statementOrderChanged: base !== null && base.claims.length === proposed.claims.length
      && base.claims.every(claim => afterIds.has(claim.id.toLowerCase()))
      && base.claims.some((claim, index) => claim.id.toLowerCase() !== proposed.claims[index].id.toLowerCase()),
    counts, statements,
  };
}
