import { proposalReport } from "./proposal_fixture.mjs";
import { encodeProposalCapture } from "../../src/server/proposal-capture.ts";
import { capturedScopeDraftContext } from "../../src/server/issue-scope-draft.ts";
export function deliveryReport() {
  const report = proposalReport(), proposed = JSON.parse(report.capture.proposalJson);
  proposed.snapshot.claims[0].type = "delivery";
  proposed.snapshot.claims[0].assertion = "An invented delivery report describes a fictional programme.";
  Object.assign(report.capture, encodeProposalCapture(proposed)); return report;
}
export const deliveryContext = () => capturedScopeDraftContext(deliveryReport());
export const emptyDeliveryDraft = c => ({ schemaVersion: 1, kind: "delivery_preparation", binding: c.binding, entries: [] });
export function deliveryEntry(c) {
  const references = number => [{ claimId: c.claims[0].id, referenceNumber: number }];
  return { claimId: c.claims[0].id, fields: {
    stage: { value: "partial", references: references(2) }, description: null, coverage: null,
    eventDate: { date: { precision: "year", value: "2030" }, references: references(1) },
    reportedDate: { date: { precision: "day", value: "2026-09-27" }, references: references(2) },
  } };
}
export function deliveryFormEntries(c, id = 1) {
  const ref = number => `${c.claims[0].id}:${number}`;
  return [["claim", c.claims[0].id], ["stage", "partial"], ["description", ""], ["coverage", ""], ["eventPrecision", "year"], ["eventValue", "2030"],
    ["reportedPrecision", ""], ["reportedValue", ""], ["stageReferences", ref(2)], ["eventDateReferences", ref(1)]]
    .map(([key, value]) => [`${id}.${key}`, value]);
}
