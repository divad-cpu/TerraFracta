import { canonicalProposalJson, type ProposalCapturePayload } from "./operator-proposal-capture.ts";

type Reference = ProposalCapturePayload["snapshot"]["claims"][number]["evidence"][number];
type Occurrence = { source: Reference; index: number };

// Already validated recorded values only. Exact full-value equality consumes
// repeated occurrences once; this is not source identity or evidence approval.
export function compareRecordedReferenceOccurrences(before: readonly Reference[], after: readonly Reference[]) {
  const beforeKeys = before.map(source => canonicalProposalJson(source));
  const afterKeys = after.map(source => canonicalProposalJson(source));
  const proposedByValue = new Map<string, number[]>();
  afterKeys.forEach((key, index) => {
    const indexes = proposedByValue.get(key);
    if (indexes) indexes.push(index);
    else proposedByValue.set(key, [index]);
  });
  const matchedProposed = new Set<number>();
  const baseOnly: Occurrence[] = [];
  beforeKeys.forEach((key, index) => {
    const proposedIndex = proposedByValue.get(key)?.shift();
    if (proposedIndex === undefined) baseOnly.push({ source: before[index], index });
    else matchedProposed.add(proposedIndex);
  });
  const proposedOnly = after.flatMap((source, index) => matchedProposed.has(index) ? [] : [{ source, index }]);
  return {
    baseOnly, proposedOnly, identical: before.length - baseOnly.length,
    orderOnly: baseOnly.length === 0 && proposedOnly.length === 0
      && beforeKeys.some((key, index) => key !== afterKeys[index]),
  };
}

export function recordedProposalReferenceAnchor(side: "base" | "proposed", claimId: string, index: number) {
  return `proposal-${side}-reference-${claimId}-${index + 1}`;
}
