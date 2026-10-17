import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { proposalReport, proposalBytes } from "./helpers/proposal_fixture.mjs";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { encodeProposalCapture } from "../src/server/proposal-capture.ts";
import { createProposalReader } from "../src/server/operator-proposal-reader.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { checkScopeDraft, scopeDraftJson } from "../src/issue-scope-draft.ts";
import { publicIssueProjectionSchema, publicationReadEnvelopeSchema } from "../src/public-issue-projection.ts";

// Synthetic records compose the two independent read contracts. No fixture
// rights, review-looking fields or completed preparation authorize publication.
function capturedPilot(rows) {
 const report = proposalReport(), snapshot = structuredClone(rows.publication.snapshot);
 const receipts = rows.sources.map((source, index) => ({ sourceVersionId: source.version.id,
  contentSha256: String(index + 1).repeat(64), retrievedAt: new Date(source.version.retrieved_at).toISOString().replace(".000Z", ".000000Z"), languageCode: "en" }));
 for (const claim of snapshot.claims) for (const source of claim.evidence)
  source.retrievedAt = receipts.find(receipt => receipt.sourceVersionId === source.sourceVersionId).retrievedAt;
 const payload = { schemaVersion: 1, kind: "review_only", snapshot, dependencyManifest: rows.publication.dependency_manifest,
  conflictCoverage: "recorded_partial", translation: { displayLanguage: "en", status: "unreviewed" } };
 Object.assign(report.target, { issueId: rows.dossier.id, jurisdictionId: rows.country.id, ...rows.requestedRoute });
 Object.assign(report.capture, encodeProposalCapture(payload), { basePublicationId: rows.publication.id });
 Object.assign(report.decision, { sourceVersionId: receipts[0].sourceVersionId, sourceSha256: receipts[0].contentSha256,
  evidenceLocator: snapshot.claims[0].evidence[0].locator });
 report.sourceReceipts = receipts;
 const base = { id: rows.publication.id, issueId: rows.dossier.id, revision: rows.publication.revision,
  kind: rows.publication.publication_kind, snapshot, dependencyManifest: rows.publication.dependency_manifest };
 const publicationJson = JSON.stringify(base), publicationSha256 = createHash("sha256").update(publicationJson).digest("hex");
 report.base = { publicationJson, publicationSha256 }; report.capture.baseContentSha256 = publicationSha256;
 return report;
}
const node = (h, tag, suffix) => h.nodes().find(row => row.type === tag && row.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const review = h => h.nodes().find(row => row.type === "button" && row.props.children === "Review scope draft");
const preview = h => h.nodes().find(row => row.type === "textarea" && row.props.readOnly)?.props.value;
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function prepare(context) {
 const h = scopeDraftHarness(context); h.mount();
 const wording = { population: "Invented population under consideration; this is not an accepted denominator.",
  period: "Invented 2024–2025 dossier scope, separate from individual statement periods.",
  selectionRationale: "Invented selection rationale requiring independent assessment of scale, severity and local relevance." };
 const types = { population: ["condition"], period: ["policy_action", "delivery", "attributed_finding"], selectionRationale: ["funding", "evaluation"] };
 for (const field of Object.keys(wording)) {
  node(h, "textarea", `-${field}-wording`).props.onChange({ currentTarget: { value: wording[field] } });
  const references = context.claims.filter(claim => types[field].includes(claim.type)).map(claim => ({ value: `${claim.id}:1` }));
  node(h, "select", `-${field}-references`).props.onChange({ currentTarget: { selectedOptions: references } });
 }
 review(h).props.onClick(); const json = preview(h); assert.ok(json); return { h, json };
}
test("six-stage captured comparison prepares and reopens scope without extending the public snapshot or borrowing private dossier fields", async t => {
 t.mock.method(globalThis, "fetch", () => assert.fail("Network dispatched"));
 const rows = sixStagePilotRows(); Object.assign(rows.dossier, { affected_population: "PRIVATE_POPULATION_CANARY", selection_rationale: "PRIVATE_SELECTION_CANARY" });
 const report = capturedPilot(rows), calls = [], diagnostics = [];
 const read = createProposalReader(async (scope, signal) => { calls.push({ scope, signal }); return proposalBytes(report); }, () => 0, code => diagnostics.push(code));
 const decision = await read(report.requested); assert.equal(decision.kind, "ok");
 const context = capturedScopeDraftContext(decision.report); assert.ok(context); assert.equal(context.claims.length, 6);
 const { h, json } = prepare(context), candidate = JSON.parse(json);
 assert.ok(Object.values(candidate.fields).every(field => field !== null));
 assert.deepEqual(candidate.fields.period.references.map(ref => context.claims.find(claim => claim.id === ref.claimId).type), ["policy_action", "delivery", "attributed_finding"]);
 h.unmount(); const reopened = scopeDraftHarness(context); reopened.mount();
 const input = { files: [new File([json], "PRIVATE_FILENAME.json")], value: "PRIVATE_FILENAME.json" };
 node(reopened, "input", "-file").props.onChange({ currentTarget: input }); await tick(); assert.equal(input.value, ""); assert.equal(preview(reopened), json);
 const html = renderToStaticMarkup(reopened.render()); assert.doesNotMatch(html, /PRIVATE_POPULATION_CANARY|PRIVATE_SELECTION_CANARY|PRIVATE_FILENAME|<form/);
 assert.match(html, /not current eligibility or authentic review/); assert.equal(publicIssueProjectionSchema.safeParse(candidate).success, false);
 const envelope = { currentPublicationId: rows.publication.id, publication: JSON.parse(report.base.publicationJson) };
 assert.equal(publicationReadEnvelopeSchema.safeParse(envelope).success, true);
 envelope.publication.snapshot.population = candidate.fields.population;
 assert.equal(publicationReadEnvelopeSchema.safeParse(envelope).success, false);
 assert.equal(calls.length, 1); assert.ok(calls[0].signal.aborted); assert.deepEqual(diagnostics, []); reopened.unmount();
});
test("fully supplied captured scope cannot clear a fresh delivery-source rights hold or survive changed comparison evidence", async () => {
 const rows = sixStagePilotRows(), report = capturedPilot(rows), context = capturedScopeDraftContext(report); assert.ok(context);
 const { h, json } = prepare(context), original = structuredClone(rows); let current = rows, calls = 0;
 const read = createPublicIssueReader(async () => { calls++; return proposalBytes(current); }, () => 0, code => assert.fail(code));
 assert.equal((await read(rows.requestedRoute)).status, 200);
 current = structuredClone(rows); const claim = current.publication.snapshot.claims.find(claim => claim.type === "delivery");
 current.sources.find(source => source.version.id === claim.evidence[0].sourceVersionId).registration.allow_public_derived = false;
 const held = await read(rows.requestedRoute); assert.deepEqual(held, { status: 503, cacheControl: "no-store" });
 // Historical preparation can still be inspected; that is deliberately not a
 // current source-rights read or an approval of any supplied field.
 assert.ok(checkScopeDraft(JSON.parse(json), capturedScopeDraftContext(report))); assert.equal(preview(h), json);
 assert.equal(publicationReadEnvelopeSchema.safeParse(JSON.parse(json)).success, false); assert.equal(calls, 2); assert.deepEqual(rows, original);
 const changed = structuredClone(report); changed.sourceReceipts.find(receipt => receipt.sourceVersionId === claim.evidence[0].sourceVersionId).contentSha256 = "c".repeat(64);
 const next = capturedScopeDraftContext(changed); assert.ok(next); assert.notEqual(next.binding.comparisonSha256, context.binding.comparisonSha256);
 assert.equal(checkScopeDraft(JSON.parse(json), next), null); h.render(next); assert.equal(preview(h), undefined); h.commit();
 assert.equal(scopeDraftJson(JSON.parse(json), next), null); h.unmount();
});
