import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { currentIssueSelection } from "../src/current-issue-navigation.ts";
const { IssueEvidence } = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url));
const { CurrentIssueNavigationView } = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url));
const issue = () => materializePublicIssueFromRows(sixStagePilotRows());
const datedWithoutConflicts = () => {
  const value = issue();
  for (const claim of value.claims) for (const source of claim.evidence) {
    source.sourcePublishedOn = "2020-01-01";
    if (source.relation === "contradicts") source.relation = "context";
  }
  return value;
};
const html = value => renderToStaticMarkup(IssueEvidence({ issue: value }));
const summary = value => /<section class="publication-limits info-band"[\s\S]*?<\/section>/.exec(html(value))?.[0] ?? assert.fail("Missing concluding limits section");

test("the dossier ends with an accessible limits section reached from its original statement outline", () => {
  const value = issue(), full = html(value), part = summary(value), nodes = elements(IssueEvidence({ issue: value }));
  assert.ok(full.indexOf(part) > full.indexOf('class="evidence-preview__claims"'));
  assert.match(part, /What remains uncertain in this publication/);
  assert.equal(nodes.filter(node => node.props.id === "issue-publication-limits").length, 1);
  assert.equal(nodes.find(node => node.props.id === "issue-publication-limits").props.tabIndex, -1);
  assert.ok(nodes.some(node => node.type === "a" && node.props.href === "#issue-publication-limits"));
  assert.ok(part.includes('href="#issue-statement-outline"'));
});
test("conflict and missing-date summaries preserve original statement and reference occurrence identities", () => {
  const value = datedWithoutConflicts(); value.claims[1].evidence.push({ ...value.claims[1].evidence[0], relation: "contradicts", sourcePublishedOn: null });
  value.claims[4].evidence[0].sourcePublishedOn = null; publicIssueProjectionSchema.parse(value);
  const part = summary(value); assert.match(part, /1 statement includes references labelled as conflicting/);
  assert.ok(part.includes(`#claim-${value.claims[1].id}`));
  assert.ok(part.includes(`#reference-${value.claims[1].id}-2`)); assert.ok(part.includes(`#reference-${value.claims[4].id}-1`));
  assert.match(part, /2 references have no verified source publication date supplied/);
  assert.match(part, /Reference 5 · Statement 2/); assert.match(part, /Reference 8 · Statement 5/);
  assert.match(part, /Retrieval dates do not fill these gaps/);
});
test("absent types name only this publication's omissions without an inaction or missing-research finding", () => {
  const value = issue(); value.claims = [value.claims[0]];
  const part = summary(value); for (const label of ["Policy or action", "Funding", "Delivery", "Attributed finding", "Evaluation"]) assert.ok(part.includes(label), label);
  assert.match(part, /No statement of these types is included/); assert.match(part, /does not establish absence of action or evidence elsewhere/);
  assert.match(part, /Population, dossier period, selection rationale and structured responsibility are not supplied/);
  assert.match(part, /Original source languages and separately reviewed upcoming milestones are not supplied/);
});
test("six categories and complete supplied dates do not become claims of settled evidence currency or causal effect", () => {
  const value = datedWithoutConflicts();
  const part = summary(value); assert.match(part, /All six statement types are represented/);
  assert.match(part, /does not establish a chronology, completed delivery or causal effect/);
  assert.match(part, /Every displayed reference supplies a source publication date/); assert.match(part, /does not establish currency or current source availability/);
  assert.match(part, /No reference is labelled as conflicting/); assert.match(part, /does not establish agreement or absence of contrary evidence elsewhere/);
});
test("maximum missing-date and conflict lists retain every exact occurrence without changing accepted input", () => {
  const value = issue(), model = value.claims[0], source = model.evidence[0];
  value.claims = Array.from({ length: 30 }, (_, i) => ({ ...model, id: `aabbccdd-aabb-4abb-8abb-${String(i + 1).padStart(12, "0")}`, evidence: Array.from({ length: 12 }, (_, j) => ({ ...source, sourcePublishedOn: null, relation: j ? "contradicts" : "supports" })) }));
  publicIssueProjectionSchema.parse(value); const before = structuredClone(value), part = summary(value);
  assert.match(part, /360 references have no verified source publication date supplied/); assert.match(part, /30 statements include references labelled as conflicting/);
  assert.equal((part.match(/href="#reference-/g) ?? []).length, 360); assert.equal((part.match(/href="#claim-/g) ?? []).length, 30);
  const nodes = elements(IssueEvidence({ issue: value })), ids = new Set(nodes.map(node => node.props.id).filter(Boolean));
  for (const match of part.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]), match[1]);
  assert.deepEqual(value, before);
});
test("a shared version counts missing dates per recorded occurrence and never implies source independence", () => {
  const value = datedWithoutConflicts(), a = value.claims[0].evidence[0], b = value.claims[1].evidence[0];
  a.sourcePublishedOn = null; b.sourcePublishedOn = null; b.sourceVersionId = a.sourceVersionId.toUpperCase();
  const part = summary(value); assert.match(part, /2 references have no verified source publication date supplied/);
  assert.match(part, /Repeated use of a source version does not establish independent confirmation/);
});
test("changed withheld absent and unavailable visits cannot retain limits or old summary targets", () => {
  const value = issue(), next = structuredClone(value); next.publicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const decision of [{ status: 200, cacheControl: "no-store", issue: next }, { status: 404, cacheControl: "no-store" }, { status: 503, cacheControl: "no-store" }]) {
    const full = renderToStaticMarkup(CurrentIssueNavigationView({ decision, selection: currentIssueSelection("issue", { edition: value.publicationId }), latestHref: "/reader-preview/latest" }));
    assert.doesNotMatch(full, /publication-limits|What remains uncertain|href="#claim-|href="#reference-/);
  }
});
test("untrusted assertion text stays escaped while limits use only fixed labels and original opaque targets", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No request"));
  const value = issue(); value.claims[0].assertion = "<script>PRIVATE_ASSERTION_CANARY</script>";
  value.claims[0].evidence.push({ ...value.claims[0].evidence[0], title: "<img src=PRIVATE_TITLE>", relation: "contradicts", sourcePublishedOn: null });
  const full = html(value), part = summary(value); assert.match(full, /&lt;script&gt;/); assert.doesNotMatch(part, /PRIVATE_ASSERTION_CANARY|PRIVATE_TITLE/);
  assert.doesNotMatch(part, /<form|<script|href="https:|onclick=|tabindex="0"/);
});
