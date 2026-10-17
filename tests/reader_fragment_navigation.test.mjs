import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { sixStagePilotRows } from "./helpers/six_stage_pilot_rows.mjs";
import { materializePublicIssueFromRows } from "../src/public-read-materializer.ts";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
import { issueReferenceAnchor, issueSourceGroupAnchor, issueSourceIndex } from "../src/issue-source-index.ts";
import { currentIssueSelection, currentIssueHref } from "../src/current-issue-navigation.ts";
const { IssueEvidence } = loadTsx(new URL("../app/issue-evidence.tsx", import.meta.url));
const { CurrentIssueNavigationView } = loadTsx(new URL("../src/current-issue-navigation-view.tsx", import.meta.url));
const issue = () => materializePublicIssueFromRows(sixStagePilotRows());
const tree = value => IssueEvidence({ issue: value });
const target = (nodes, id) => { const matching = nodes.filter(node => node.props.id === id); assert.equal(matching.length, 1, id); return matching[0]; };
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test("each statement arrival and native outline return has one focusable target while original claim IDs remain exact", () => {
 const value = issue(), nodes = elements(tree(value));
 assert.equal(target(nodes, "issue-statement-outline").props.tabIndex, -1);
 for (const claim of value.claims) assert.equal(target(nodes, `claim-${claim.id}`).props.tabIndex, -1);
 const returns = nodes.filter(node => node.type === "a" && node.props.href === "#issue-statement-outline"); assert.equal(returns.length, value.claims.length + 1);
 assert.ok(returns.every(node => node.props.children === "Back to statements in this dossier"));
 for (const claim of value.claims) assert.ok(nodes.some(node => node.type === "a" && node.props.href === `#claim-${claim.id}`));
});
test("all exact citation and grouped-source destinations gain native focus without changing occurrence or source identity", () => {
 const value = issue(), nodes = elements(tree(value)), index = issueSourceIndex(value);
 for (const claim of value.claims) for (let i = 0; i < claim.evidence.length; i++) assert.equal(target(nodes, issueReferenceAnchor(claim.id, i)).props.tabIndex, -1);
 for (let i = 0; i < index.groups.length; i++) assert.equal(target(nodes, issueSourceGroupAnchor(i)).props.tabIndex, -1);
 assert.equal(nodes.filter(node => node.props.tabIndex === -1).length, 2 + value.claims.length + index.referenceCount + index.groups.length);
 assert.ok(nodes.filter(node => node.props.tabIndex !== undefined).every(node => node.props.tabIndex === -1));
});
test("maximum30 statements and360 references keep unique targets repeated metadata ordinals and bounded outline returns", () => {
 const value = issue(), base = value.claims[0];
 value.claims = Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(base), id: `aabbccdd-aabb-4abb-8abb-${String(i + 1).padStart(12, "0")}`,
  evidence: Array.from({ length: 12 }, (_, j) => ({ ...structuredClone(base.evidence[0]), locator: `Invented cell ${i}:${j}` })) }));
 publicIssueProjectionSchema.parse(value); const nodes = elements(tree(value)), ids = nodes.map(node => node.props.id).filter(Boolean);
 assert.equal(new Set(ids).size, ids.length); assert.equal(nodes.filter(node => node.type === "a" && node.props.href === "#issue-statement-outline").length, 31);
 const indexed = issueSourceIndex(value); assert.equal(indexed.referenceCount, 360); assert.equal(indexed.groups.length, 1);
 for (const reference of indexed.groups[0].references) assert.equal(target(nodes, reference.anchor).props.tabIndex, -1);
 const html = renderToStaticMarkup(tree(value)); assert.match(html, /Reference 360 ·/); assert.match(html, /not a ranking or a timeline/);
 assert.match(html, /do not establish independent confirmation/);
});
test("current changed absent and unavailable views withhold every new target and old text instead of preserving an outline fallback", () => {
 const value = issue(), next = structuredClone(value); next.publicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 for (const decision of [{ status: 200, cacheControl: "no-store", issue: next }, { status: 404, cacheControl: "no-store" }, { status: 503, cacheControl: "no-store" }]) {
  const html = renderToStaticMarkup(CurrentIssueNavigationView({ decision, selection: currentIssueSelection("issue", { edition: value.publicationId }), latestHref: currentIssueHref(value, "issue", false) }));
  assert.doesNotMatch(html, /issue-statement-outline|Back to statements in this dossier|id="claim-|id="reference-/); assert.ok(!html.includes(value.claims[0].assertion));
 }
});
test("frozen input original wording periods and escaped source metadata remain unchanged with no new request form or script", t => {
 t.mock.method(globalThis, "fetch", () => assert.fail("Presentation must not request"));
 const value = issue(); value.claims[0].assertion = "<img src=x> Invented statement"; value.claims[0].evidence[0].title = "<script>Invented source</script>";
 const before = structuredClone(value); freeze(value); const html = renderToStaticMarkup(tree(value)); assert.deepEqual(value, before);
 assert.match(html, /&lt;img src=x&gt;/); assert.match(html, /&lt;script&gt;Invented source/); assert.doesNotMatch(html, /<img|<script|<form|onclick=|tabindex="0"/);
 const nodes = elements(tree(value)); assert.equal(nodes.filter(node => node.type === "nav" && node.props["aria-label"] === "Statements in this dossier").length, 1);
});
