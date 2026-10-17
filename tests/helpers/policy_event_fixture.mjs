import { proposalReport } from "./proposal_fixture.mjs";
import { encodeProposalCapture } from "../../src/server/proposal-capture.ts";
import { capturedScopeDraftContext } from "../../src/server/issue-scope-draft.ts";
export function policyEventReport() {
  const report = proposalReport(), proposed = JSON.parse(report.capture.proposalJson);
  proposed.snapshot.claims[0].type = "policy_action";
  proposed.snapshot.claims[0].assertion = "A fictional authority announced an invented programme.";
  Object.assign(report.capture, encodeProposalCapture(proposed)); return report;
}
export const policyEventContext = () => capturedScopeDraftContext(policyEventReport());
export const emptyPolicyEventDraft = c => ({ schemaVersion: 1, kind: "policy_event_preparation", binding: c.binding, entries: [] });
export function policyEventEntry(c) {
  const references = number => [{ claimId: c.claims[0].id, referenceNumber: number }];
  return { claimId: c.claims[0].id, fields: {
    kind: { value: "announcement", references: references(2) }, description: null,
    eventDate: { date: { precision: "year", value: "2030" }, references: references(1) },
    reportedDate: { date: { precision: "day", value: "2026-09-27" }, references: references(2) },
  } };
}
export function policyEventFormEntries(c, id = 1) {
  const ref = number => `${c.claims[0].id}:${number}`;
  return [["claim", c.claims[0].id], ["kind", "announcement"], ["description", ""], ["eventPrecision", "year"], ["eventValue", "2030"],
    ["reportedPrecision", ""], ["reportedValue", ""], ["kindReferences", ref(2)], ["eventDateReferences", ref(1)]]
    .map(([key, value]) => [`${id}.${key}`, value]);
}
// Structural control doubles for native handler tests; this is not a DOM or
// Browser acceptance surface. Real keyboard/control collection stays separate.
export function fakePolicyEventControls(pairs) {
  const controls = [], grouped = new Map();
  for (const [name, value] of pairs) {
    if (name.endsWith("References")) { const values = grouped.get(name) ?? []; values.push(value); grouped.set(name, values); }
    else controls.push({ getAttribute: key => key === "name" ? name : null, tagName: "INPUT", type: "text", value });
  }
  for (const [name, values] of grouped) controls.push({ getAttribute: key => key === "name" ? name : null, tagName: "SELECT", multiple: true,
    selectedOptions: { length: values.length, item: index => values[index] === undefined ? null : { value: values[index] } } });
  return { elements: { length: controls.length, item: index => controls[index] ?? null } };
}
