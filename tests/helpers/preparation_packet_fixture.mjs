import { proposalReport, proposalId } from "./proposal_fixture.mjs";
import { encodeProposalCapture } from "../../src/server/proposal-capture.ts";
import { capturedScopeDraftContext } from "../../src/server/issue-scope-draft.ts";
import { scopeDraftJson } from "../../src/issue-scope-draft.ts";
import { responsibilityDraftJson } from "../../src/responsibility-draft.ts";
import { policyEventDraftJson } from "../../src/policy-event-draft.ts";
import { fundingDraftJson, fundingFieldLabels } from "../../src/funding-draft.ts";
import { indicatorDraftJson, indicatorFieldLabels } from "../../src/indicator-draft.ts";
import { deliveryDraftJson } from "../../src/delivery-draft.ts";
export function packetReport() {
  const report = proposalReport(), payload = JSON.parse(report.capture.proposalJson), original = payload.snapshot.claims[0];
  payload.snapshot.claims = ["condition", "policy_action", "funding", "delivery", "attributed_finding", "evaluation"].map((type, i) => ({
    ...structuredClone(original), id: proposalId(201 + i), type, assertion: `Invented ${type} statement for a private local packet.`,
  }));
  Object.assign(report.capture, encodeProposalCapture(payload)); return report;
}
export const packetContext = () => capturedScopeDraftContext(packetReport());
export function packetParts(c) {
  const claim = type => c.claims.find(claim => claim.type === type).id;
  const ref = type => [{ claimId: claim(type), referenceNumber: 1 }];
  const common = kind => ({ schemaVersion: 1, kind, binding: c.binding });
  return {
    scope: scopeDraftJson({ ...common("issue_scope_preparation"), fields: { population: { wording: "Invented local population", references: ref("condition") }, period: null, selectionRationale: null } }, c),
    responsibility: responsibilityDraftJson({ ...common("responsibility_preparation"), entries: [{ claimId: claim("policy_action"), fields: {
      institution: { wording: "Invented authority", references: ref("policy_action") }, governmentLevel: null, role: null, period: null,
    } }] }, c),
    policyEvents: policyEventDraftJson({ ...common("policy_event_preparation"), entries: [{ claimId: claim("policy_action"), fields: {
      kind: { value: "announcement", references: ref("policy_action") }, description: null, eventDate: null, reportedDate: null,
    } }] }, c),
    funding: fundingDraftJson({ ...common("funding_preparation"), entries: [{ claimId: claim("funding"), fields: {
      ...Object.fromEntries(Object.keys(fundingFieldLabels).map(field => [field, null])), amount: { value: "-0.000", references: ref("funding") },
    } }] }, c),
    indicators: indicatorDraftJson({ ...common("indicator_preparation"), entries: [{ claimId: claim("condition"), fields: {
      ...Object.fromEntries(Object.keys(indicatorFieldLabels).map(field => [field, null])), missingReason: { value: "withheld", references: ref("condition") },
    } }] }, c),
    delivery: deliveryDraftJson({ ...common("delivery_preparation"), entries: [{ claimId: claim("delivery"), fields: {
      stage: { value: "pilot", references: ref("delivery") }, description: null, coverage: null, eventDate: null, reportedDate: null,
    } }] }, c),
  };
}
