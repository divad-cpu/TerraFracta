import assert from "node:assert/strict";
import test from "node:test";
import { checkResponsibilityDraft, checkedResponsibilityContext, responsibilityDraftJson, reopenResponsibilityDraftJson, RESPONSIBILITY_DRAFT_BYTES } from "../src/responsibility-draft.ts";
import { checkScopeDraft, reopenScopeDraftJson } from "../src/issue-scope-draft.ts";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const context = () => capturedScopeDraftContext(proposalReport());
const fields = () => ({ institution: null, governmentLevel: null, role: null, period: null });
const candidate = (c = context()) => ({ schemaVersion: 1, kind: "responsibility_preparation", binding: c.binding, entries: [] });
const supplied = (c, wording = "Invented authority") => ({ wording, references: [{ claimId: c.claims[0].id, referenceNumber: 1 }] });
const entry = c => ({ claimId: c.claims[0].id, fields: { ...fields(), institution: supplied(c), role: supplied(c, "Introduced the invented programme"), period: supplied(c, "2024") } });

test("empty responsibility entries and nullable fields preserve unknowns rather than copying source publishers or periods", () => {
  const c = context(), draft = candidate(c); assert.deepEqual(checkResponsibilityDraft(draft, c), draft);
  draft.entries.push({ claimId: c.claims[0].id, fields: fields() });
  assert.deepEqual(checkResponsibilityDraft(draft, c), draft); assert.ok(!JSON.stringify(draft).includes(c.claims[0].periodLabel));
});
test("several dated authorities can belong to one statement without merging introduction amendment funding and delivery", () => {
  const c = context(), draft = candidate(c); draft.entries = [entry(c), { ...entry(c), fields: { ...entry(c).fields,
    institution: supplied(c, "Another invented authority"), governmentLevel: supplied(c, "Regional"), role: supplied(c, "Delivered a later phase"), period: supplied(c, "2025–2026") } }];
  const before = structuredClone(draft), checked = checkResponsibilityDraft(draft, c); assert.deepEqual(checked, draft); assert.deepEqual(draft, before);
  assert.equal(checked.entries[0].fields.period.wording, "2024"); assert.equal(checked.entries[1].fields.period.wording, "2025–2026");
});
test("each supplied field requires exact existing distinct occurrences and does not upgrade a conflict label to support", () => {
  const c = context(), draft = candidate(c); draft.entries = [entry(c)];
  draft.entries[0].fields.role.references = [{ claimId: c.claims[0].id, referenceNumber: 2 }];
  assert.ok(checkResponsibilityDraft(draft, c));
  for (const refs of [[], [null], [{ claimId: proposalId(99), referenceNumber: 1 }], [{ claimId: c.claims[0].id, referenceNumber: 12 }], [draft.entries[0].fields.role.references[0], draft.entries[0].fields.role.references[0]]]) {
    const bad = structuredClone(draft); bad.entries[0].fields.role.references = refs; assert.equal(checkResponsibilityDraft(bad, c), null);
  }
  const blank = structuredClone(draft); blank.entries[0].fields.institution.wording = " "; assert.equal(checkResponsibilityDraft(blank, c), null);
});
test("foreign statement association duplicates aliases extra fields and excess rows remain held", () => {
  const c = context(), draft = candidate(c); draft.entries = [entry(c)];
  for (const mutate of [x => x.entries[0].claimId = proposalId(99), x => x.entries.push(structuredClone(x.entries[0])), x => x.entries[0].fields.secret = null,
    x => x.entries[0].accepted = true, x => x.accepted = true, x => x.binding.approved = true, x => x.entries = Array.from({ length: 9 }, () => entry(c))]) {
    const bad = structuredClone(draft); mutate(bad); assert.equal(checkResponsibilityDraft(bad, c), null);
  }
  const alias = structuredClone(c); alias.claims.push({ ...alias.claims[0], id: alias.claims[0].id.toUpperCase() });
  assert.equal(checkedResponsibilityContext(alias), null);
});
test("all six captured binding values and evidence-display context participate without accepting changed reopening", () => {
  const c = context(), draft = candidate(c), json = responsibilityDraftJson(draft, c);
  for (const name of Object.keys(c.binding)) {
    const changed = structuredClone(c); changed.binding[name] = name.endsWith("Sha256") ? "c".repeat(64) : proposalId(99);
    assert.equal(checkResponsibilityDraft(draft, changed), null); assert.equal(reopenResponsibilityDraftJson(json, changed), null);
  }
  const report = proposalReport(); report.sourceReceipts[0].contentSha256 = "c".repeat(64);
  assert.equal(reopenResponsibilityDraftJson(json, capturedScopeDraftContext(report)), null);
});
test("Unicode wording uses existing 1200 code-point limits while the complete export independently enforces UTF-8 bytes", () => {
  const c = context(), draft = candidate(c); draft.entries = [entry(c)];
  draft.entries[0].fields.institution.wording = "😀".repeat(1200); assert.ok(responsibilityDraftJson(draft, c));
  draft.entries[0].fields.institution.wording += "😀"; assert.equal(checkResponsibilityDraft(draft, c), null);
  draft.entries = Array.from({ length: 8 }, (_, i) => ({ ...entry(c), fields: { ...fields(), institution: supplied(c, String(i) + "😀".repeat(1199)) } }));
  assert.ok(checkResponsibilityDraft(draft, c)); assert.equal(responsibilityDraftJson(draft, c), null);
  assert.equal(reopenResponsibilityDraftJson(" ".repeat(RESPONSIBILITY_DRAFT_BYTES + 1), c), null);
});
test("only exact canonical copied JSON reopens; whitespace duplicate keys normalized wording and kind substitution refuse", () => {
  const c = context(), draft = candidate(c); draft.entries = [entry(c)]; const json = responsibilityDraftJson(draft, c);
  assert.deepEqual(reopenResponsibilityDraftJson(json, c), draft);
  for (const bad of [json + "\n", JSON.stringify(draft), json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'), json.replace('"Invented authority"', '" Invented authority "'), json.replace('"responsibility_preparation"', '"issue_scope_preparation"')]) assert.equal(reopenResponsibilityDraftJson(bad, c), null);
  assert.equal(checkScopeDraft(draft, c), null); assert.equal(reopenScopeDraftJson(json, c), null);
});
test("a private preparation cannot enter the existing closed public envelope or grant source/publication eligibility", () => {
  const c = context(), draft = candidate(c), issue = materializePublicIssueFromRows(sixStagePilotRows());
  // The closed boundary must reject a separate private field regardless of content.
  assert.equal(publicIssueProjectionSchema.safeParse(issue).success, true);
  assert.equal(publicIssueProjectionSchema.safeParse({ ...issue, responsibility: draft }).success, false);
  assert.equal(checkResponsibilityDraft({ ...draft, eligible: true }, c), null);
  assert.equal(checkResponsibilityDraft({ ...draft, binding: new Proxy({}, { get() { throw Error("PRIVATE"); } }) }, c), null);
  assert.equal(checkedResponsibilityContext(new Proxy({}, { get() { throw Error("PRIVATE"); } })), null);
});
