import { evidenceLabels, statementLabels, type EvidenceRelation, type StatementType } from "./issue-display-labels.ts";
import { searchText } from "./search-text.ts";
import type { recordedProposalSourceIndex } from "./recorded-proposal-source-index.ts";

export type RecordedReferenceEntry = Readonly<{
  side: "base" | "proposed"; statementNumber: number; referenceNumber: number;
  statementType: StatementType; periodLabel: string; anchor: string;
  sourceVersionId: string; title: string; locator: string; relation: EvidenceRelation;
}>;
export const recordedReferenceRoleLabels: Readonly<Record<EvidenceRelation, string>> = {
  supports: "Supporting evidence", contradicts: "Conflicting evidence", context: "Context",
};

// Minimal serializable labels from the already checked comparison. No raw
// snapshots, URLs, receipts, source bytes or new provider scope cross this seam.
export function recordedReferenceEntries(index: ReturnType<typeof recordedProposalSourceIndex>): RecordedReferenceEntry[] {
  return index.groups.flatMap(group => group.occurrences.map(occurrence => ({
    side: occurrence.side, statementNumber: occurrence.statementIndex + 1,
    referenceNumber: occurrence.referenceIndex + 1, statementType: occurrence.claim.type,
    periodLabel: occurrence.claim.periodLabel, anchor: occurrence.anchor,
    sourceVersionId: occurrence.source.sourceVersionId, title: occurrence.source.title,
    locator: occurrence.source.locator, relation: occurrence.source.relation,
  }))).sort((a, b) => Number(a.side === "proposed") - Number(b.side === "proposed") ||
    a.statementNumber - b.statementNumber || a.referenceNumber - b.referenceNumber);
}

// All words belong to one original occurrence. Filtering changes only locator
// results; complete source groups, conflict notices and both panels stay intact.
export function matchingRecordedReferences(entries: readonly RecordedReferenceEntry[], query: unknown,
  side: unknown = "", statementType: unknown = "", relation: unknown = ""): RecordedReferenceEntry[] | null {
  const search = searchText(query);
  if (search.kind === "invalid" || (side !== "" && side !== "base" && side !== "proposed") ||
      typeof statementType !== "string" || (statementType !== "" && !Object.hasOwn(statementLabels, statementType)) ||
      typeof relation !== "string" || (relation !== "" && !Object.hasOwn(evidenceLabels, relation))) return null;
  const words = search.query.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  return entries.filter(entry => {
    if ((side && entry.side !== side) || (statementType && entry.statementType !== statementType) ||
        (relation && entry.relation !== relation)) return false;
    const labels = [entry.side === "base" ? "Recorded" : "Proposed", `statement ${entry.statementNumber}`,
      statementLabels[entry.statementType], entry.periodLabel, `reference ${entry.referenceNumber}`,
      entry.sourceVersionId, entry.title, entry.locator, recordedReferenceRoleLabels[entry.relation], evidenceLabels[entry.relation]];
    const normalized = labels.map(value => value.normalize("NFKC").toLocaleLowerCase("en"));
    return words.every(word => normalized.some(value => value.includes(word)));
  });
}
