import { proposalReport } from "./proposal_fixture.mjs";
import { encodeProposalCapture } from "../../src/server/proposal-capture.ts";
import { capturedScopeDraftContext } from "../../src/server/issue-scope-draft.ts";
import { indicatorFieldLabels } from "../../src/indicator-draft.ts";
export function indicatorReport() {
 const report = proposalReport(), payload = JSON.parse(report.capture.proposalJson);
 payload.snapshot.claims[0].type = "condition"; payload.snapshot.claims[0].assertion = "An invented source reports a fictional measured condition.";
 Object.assign(report.capture, encodeProposalCapture(payload)); return report;
}
export const indicatorContext = () => capturedScopeDraftContext(indicatorReport());
export const indicatorFields = () => Object.fromEntries(Object.keys(indicatorFieldLabels).map(key => [key, null]));
export const emptyIndicatorDraft = c => ({ schemaVersion: 1, kind: "indicator_preparation", binding: c.binding, entries: [] });
export function indicatorEntry(c, value = "9007199254740993.000000001") {
 const field = (value, number = 1) => ({ value, references: [{ claimId: c.claims[0].id, referenceNumber: number }] });
 return { claimId: c.claims[0].id, fields: { sourceSeries: field("fictional series A"), definition: field("Invented numerator over a stated denominator"),
  definitionVersion: field("definition 2", 2), unit: field("percent; no multiplication applied"), geography: field("fictional local area"),
  population: field("fictional adults"), denominator: field("responding sample, exclusions stated by source"), adjustment: field("unadjusted"),
  frequency: field("irregular"), observationPeriod: field("fieldwork interval 2024/25"), value: field(value), missingReason: null, vintage: field("revised edition B") } };
}
export function indicatorFormEntries(c, id = 1, value = "9007199254740993.000000001") {
 const entry = indicatorEntry(c, value);
 return [[`${id}.claim`, c.claims[0].id], ...Object.entries(entry.fields).flatMap(([key, field]) =>
  [[`${id}.${key}`, field?.value ?? ""], ...(field?.references.map(ref => [`${id}.${key}References`, `${ref.claimId}:${ref.referenceNumber}`]) ?? [])])];
}
