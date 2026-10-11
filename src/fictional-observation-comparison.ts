import { fictionalPublicationDraftSchema, type FictionalPublicationDraft } from "./fictional-publication-draft.ts";
import { compareRecordedInstants } from "./recorded-instant-order.ts";

export type FictionalObservationComparison =
  | { kind: "held" }
  | { kind: "changed" | "unchanged"; period: string; beforeValue: string; afterValue: string;
      deltaPercentagePoints: string; beforeRetrievedAt: string; afterRetrievedAt: string;
      beforeUrl: string; afterUrl: string; locator: string;
      beforeSourceVersionId: string; afterSourceVersionId: string;
      beforeContentSha256: string; afterContentSha256: string };

const tenths = (value: string) => {
  const [whole, fraction = "0"] = value.split(".");
  return Number(whole) * 10 + Number(fraction);
};

// Only the fixed fictional percent drafts. A source revision within one period
// is not a trend across years, a relative percent change or causal evidence.
function compareCheckedObservations(before: FictionalPublicationDraft, after: FictionalPublicationDraft): FictionalObservationComparison {
  const oldEvidence = before.publication.snapshot.claims[0].evidence[0];
  const newEvidence = after.publication.snapshot.claims[0].evidence[0];
  const retrievalOrder = compareRecordedInstants(oldEvidence.retrievedAt, newEvidence.retrievedAt);
  if (["seriesId", "geography", "period", "unit", "semanticContractSha256"].some(
    (key) => before.observation[key as keyof typeof before.observation] !==
      after.observation[key as keyof typeof after.observation]) ||
      before.publication.issueId !== after.publication.issueId ||
      oldEvidence.locator !== newEvidence.locator ||
      oldEvidence.url !== newEvidence.url || oldEvidence.publisher !== newEvidence.publisher ||
      retrievalOrder > 0) return { kind: "held" };
  const delta = tenths(after.observation.value) - tenths(before.observation.value);
  const sameHash = before.decision.contentSha256 === after.decision.contentSha256;
  const sameVersion = before.decision.sourceVersionId === after.decision.sourceVersionId;
  if (sameHash !== sameVersion || (delta !== 0 && (sameHash ||
      retrievalOrder === 0))) return { kind: "held" };
  const absolute = Math.abs(delta);
  return { kind: delta === 0 ? "unchanged" : "changed", period: after.observation.period,
    beforeValue: before.observation.value, afterValue: after.observation.value,
    deltaPercentagePoints: `${delta < 0 ? "−" : delta > 0 ? "+" : ""}${Math.floor(absolute / 10)}.${absolute % 10}`,
    beforeRetrievedAt: oldEvidence.retrievedAt, afterRetrievedAt: newEvidence.retrievedAt,
    beforeUrl: oldEvidence.url, afterUrl: newEvidence.url, locator: newEvidence.locator,
    beforeSourceVersionId: before.decision.sourceVersionId, afterSourceVersionId: after.decision.sourceVersionId,
    beforeContentSha256: before.decision.contentSha256, afterContentSha256: after.decision.contentSha256 };
}

export function compareFictionalObservations(beforeInput: unknown, afterInput: unknown): FictionalObservationComparison {
  try {
    return compareCheckedObservations(fictionalPublicationDraftSchema.parse(beforeInput), fictionalPublicationDraftSchema.parse(afterInput));
  } catch { return { kind: "held" }; }
}

export function exportFictionalComparison(beforeInput: unknown, afterInput: unknown): string {
  let before: FictionalPublicationDraft, after: FictionalPublicationDraft, comparison: FictionalObservationComparison;
  try {
    before = fictionalPublicationDraftSchema.parse(beforeInput);
    after = fictionalPublicationDraftSchema.parse(afterInput);
    comparison = compareCheckedObservations(before, after);
  } catch { throw new Error("Comparison cannot be exported"); }
  if (comparison.kind === "held") throw new Error("Comparison cannot be exported");
  const observation = (draft: typeof before, retrievedAt: string, url: string) => ({
    value: draft.observation.value, unit: "percent", period: draft.observation.period,
    sourceVersionId: draft.decision.sourceVersionId,
    contentSha256: draft.decision.contentSha256,
    semanticContractSha256: draft.observation.semanticContractSha256,
    retrievedAt, url, locator: draft.decision.locator,
  });
  return JSON.stringify({ schemaVersion: 1, artifactKind: "fictional_observation_comparison",
    state: "draft", publicChanges: 0, comparisonKind: "same_period_source_revision",
    before: observation(before, comparison.beforeRetrievedAt, comparison.beforeUrl),
    after: observation(after, comparison.afterRetrievedAt, comparison.afterUrl),
    deltaPercentagePoints: comparison.deltaPercentagePoints,
    limitation: "Invented observations. No real source, publication or causal conclusion.",
  }, null, 2) + "\n";
}
