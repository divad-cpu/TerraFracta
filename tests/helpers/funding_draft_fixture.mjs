import { policyEventReport } from "./policy_event_fixture.mjs";
import { encodeProposalCapture } from "../../src/server/proposal-capture.ts";
import { capturedScopeDraftContext } from "../../src/server/issue-scope-draft.ts";
import { fundingFieldLabels } from "../../src/funding-draft.ts";
export function fundingReport() {
  const report = policyEventReport(), payload = JSON.parse(report.capture.proposalJson);
  payload.snapshot.claims[0].type = "funding"; payload.snapshot.claims[0].assertion = "A fictional budget allocated an invented amount.";
  Object.assign(report.capture, encodeProposalCapture(payload)); return report;
}
export const fundingContext = () => capturedScopeDraftContext(fundingReport());
export const emptyFundingDraft = c => ({ schemaVersion: 1, kind: "funding_preparation", binding: c.binding, entries: [] });
export const fundingFields = () => Object.fromEntries(Object.keys(fundingFieldLabels).map(key => [key, null]));
export function fundingEntry(c, amount = "9007199254740993.000000001") {
  const field = (value, number = 1) => ({ value, references: [{ claimId: c.claims[0].id, referenceNumber: number }] });
  return { claimId: c.claims[0].id, fields: { ...fundingFields(), stage: field("allocated", 2), amount: field(amount), currency: field("NOK"),
    scale: field("millions"), financialPeriod: field("FY 2026/27"), priceBasis: field("constant_prices"), priceBasePeriod: field("2020"),
    coverage: field("cumulative"), revisionRelation: field("replaces_earlier") } };
}
export function fundingFormEntries(c, id = 1, amount = "9007199254740993.000000001") {
  const entry = fundingEntry(c, amount);
  return [[`${id}.claim`, c.claims[0].id], ...Object.entries(entry.fields).flatMap(([key, field]) =>
    [[`${id}.${key}`, field?.value ?? ""], ...(field?.references.map(ref => [`${id}.${key}References`, `${ref.claimId}:${ref.referenceNumber}`]) ?? [])])];
}
