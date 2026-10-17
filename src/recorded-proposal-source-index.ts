import type { ProposalCapturePayload } from "./operator-proposal-capture.ts";
import { recordedProposalReferenceAnchor } from "./recorded-reference-differences.ts";

type Snapshot = ProposalCapturePayload["snapshot"];
type Side = "base" | "proposed";
type Occurrence = {
  side: Side; claim: Snapshot["claims"][number]; statementIndex: number;
  source: Snapshot["claims"][number]["evidence"][number]; referenceIndex: number; anchor: string;
};

// Already checked captured panels only. Exact version identity groups uses,
// never origins or equal metadata. Every side-position occurrence is retained.
// UUID case is spelling, not another version; keep the first supplied spelling
// on the group and every original spelling/metadata on its own occurrence.
export function recordedProposalSourceIndex(base: Snapshot | null, proposed: Snapshot) {
  const versions = new Map<string, { sourceVersionId: string; occurrences: Occurrence[] }>();
  const add = (side: Side, snapshot: Snapshot) => snapshot.claims.forEach((claim, statementIndex) => {
    claim.evidence.forEach((source, referenceIndex) => {
      const identity = source.sourceVersionId.toLowerCase();
      let version = versions.get(identity);
      if (!version) { version = { sourceVersionId: source.sourceVersionId, occurrences: [] }; versions.set(identity, version); }
      const { occurrences } = version;
      occurrences.push({ side, claim, statementIndex, source, referenceIndex,
        anchor: recordedProposalReferenceAnchor(side, claim.id, referenceIndex) });
    });
  });
  if (base !== null) add("base", base);
  add("proposed", proposed);
  const groups = [...versions.values()].map(({ sourceVersionId, occurrences }, index) => {
    const count = (side: Side) => {
      const selected = occurrences.filter(occurrence => occurrence.side === side);
      return { references: selected.length, statements: new Set(selected.map(occurrence => occurrence.claim.id)).size };
    };
    return { sourceVersionId, occurrences, anchor: `proposal-source-version-${index + 1}`,
      number: index + 1, base: count("base"), proposed: count("proposed") };
  });
  return { groups, referenceCount: groups.reduce((sum, group) => sum + group.occurrences.length, 0) };
}
