import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { matchingScopeReferenceKeys } from "../src/issue-scope-reference-search.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { decodeProposalCapture, encodeProposalCapture } from "../src/server/proposal-capture.ts";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";

function context(change) {
  const report = proposalReport();
  const payload = decodeProposalCapture(report.capture.proposalJson, report.capture.proposalSha256);
  change(payload.snapshot.claims[0]);
  report.decision.evidenceLocator = payload.snapshot.claims[0].evidence[0].locator;
  Object.assign(report.capture, encodeProposalCapture(payload));
  const result = capturedScopeDraftContext(report);
  assert.ok(result, "the actual captured comparison must admit the invented Unicode metadata");
  return result;
}
const first = `${proposalId(3)}:1`, second = `${proposalId(3)}:2`;

for (const [field, stored, query, expected = [first]] of [
  ["title", "Invented Cafe\u0301 table", "Café"],
  ["title", "Invented ＴＡＢＬＥ", "ＴＡＢＬＥ", [first, second]],
  ["title", "Invented ﬁle", "file"],
  ["locator", "Invented section Ⅳ", "IV"],
]) test(`scope reference search finds the normalized visible ${field}: ${stored}`, () => {
  const ctx = context(claim => { claim.evidence[0][field] = stored; });
  const before = structuredClone(ctx);
  assert.deepEqual(matchingScopeReferenceKeys(ctx, query), expected);
  assert.deepEqual(ctx, before, "search cannot normalize recorded display values or the captured binding");
});

test("scope period words normalize while original reference order and occurrence numbers remain", () => {
  const ctx = context(claim => { claim.periodLabel = "Invented Ｑ１ ２０２６"; });
  assert.deepEqual(matchingScopeReferenceKeys(ctx, "q1 2026"), [first, second]);
  assert.deepEqual(matchingScopeReferenceKeys(ctx, "q1 contrasting"), [second]);
});

test("normalized search still requires every word in one occurrence and rejects invalid input", () => {
  const ctx = context(claim => {
    claim.evidence[0].title = "Invented Cafe\u0301";
    claim.evidence[1].title = "Invented ＴＡＢＬＥ";
  });
  assert.deepEqual(matchingScopeReferenceKeys(ctx, "café table"), []);
  assert.deepEqual(matchingScopeReferenceKeys(ctx, "cafe"), [], "normalization does not strip meaningful accents");
  for (const q of [null, [], "\0", "x".repeat(81), "\ufdfa".repeat(5)])
    assert.equal(matchingScopeReferenceKeys(ctx, q), null);
  assert.deepEqual(matchingScopeReferenceKeys(ctx, ""), [first, second]);
});

test("actual scope chooser presents the original glyphs and exact IDs after Unicode lookup", () => {
  const ctx = context(claim => { claim.evidence[0].title = "Invented ﬁle Cafe\u0301"; });
  const h = scopeDraftHarness(ctx); h.mount();
  try {
    h.nodes().find(n => n.type === "input" && n.props.id?.endsWith("-reference-search")).props.onChange({ currentTarget: { value: "file café" } });
    const select = h.nodes().find(n => n.type === "select" && n.props.id?.endsWith("-population-references"));
    assert.deepEqual(select.props.children.map(option => option.props.value), [first]);
    const html = renderToStaticMarkup(h.render());
    assert.match(html, /Invented ﬁle Cafe\u0301/);
    assert.match(html, /1 of 2 recorded reference choices match/);
    assert.deepEqual(ctx.claims[0].evidence[0].title, "Invented ﬁle Cafe\u0301");
  } finally { h.unmount(); }
});
