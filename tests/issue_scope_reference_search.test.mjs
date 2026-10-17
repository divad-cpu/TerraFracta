import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { matchingScopeReferenceKeys } from "../src/issue-scope-reference-search.ts";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { scopeDraftJson } from "../src/issue-scope-draft.ts";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const context = () => capturedScopeDraftContext(proposalReport());
const control = (h, tag, suffix) => h.nodes().find(row => row.type === tag && row.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const button = (h, text) => h.nodes().find(row => row.type === "button" && row.props.children === text);
const preview = h => h.nodes().find(row => row.type === "textarea" && row.props.readOnly)?.props.value;
const filter = (h, value) => control(h, "input", "-reference-search").props.onChange({ currentTarget: { value } });
const options = (h, field = "population") => control(h, "select", `-${field}-references`).props.children;
function prepare(h) {
 control(h, "textarea", "-population-wording").props.onChange({ currentTarget: { value: "Invented scope under review" } });
 control(h, "select", "-population-references").props.onChange({ currentTarget: { selectedOptions: [{ value: `${proposalId(3)}:1` }] } });
 button(h, "Review scope draft").props.onClick(); assert.ok(preview(h));
}
test("reference search matches all words within one exact occurrence and keeps original order and position", () => {
 const ctx = context(), before = structuredClone(ctx);
 assert.deepEqual(matchingScopeReferenceKeys(ctx, ""), [`${proposalId(3)}:1`, `${proposalId(3)}:2`]);
 assert.deepEqual(matchingScopeReferenceKeys(ctx, " ＣＯＮＴＲＡＳＴＩＮＧ  contradicts "), [`${proposalId(3)}:2`]);
 assert.deepEqual(matchingScopeReferenceKeys(ctx, "observed 2026 row 2"), [`${proposalId(3)}:1`, `${proposalId(3)}:2`], "Substring2 also matches the displayed period2026");
 assert.deepEqual(matchingScopeReferenceKeys(ctx, "supports contrasting"), []);
 assert.deepEqual(matchingScopeReferenceKeys(ctx, "https example publisher"), [], "Omitted raw metadata is not searchable");
 assert.deepEqual(ctx, before);
});
test("invalid query or corrupt context cannot broaden the local reference choices", () => {
 for (const value of [null, [], {}, "x".repeat(81), "invalid\u0000query", "\u3316".repeat(40)]) assert.equal(matchingScopeReferenceKeys(context(), value), null);
 assert.equal(matchingScopeReferenceKeys({}, ""), null); assert.equal(matchingScopeReferenceKeys(new Proxy({}, { get() { throw Error("PRIVATE"); } }), ""), null);
});
test("filtered and invalid views preserve selected occurrences and the exact unsent draft without renumbering", () => {
 const h = scopeDraftHarness(context()); h.mount(); prepare(h); const json = preview(h);
 filter(h, "contrasting"); assert.equal(preview(h), json);
 assert.equal(options(h).length, 2); assert.equal(options(h, "period").length, 1);
 assert.equal(options(h, "period")[0].props.value, `${proposalId(3)}:2`);
 let html = renderToStaticMarkup(h.render()); assert.match(html, /1 of 2 recorded reference choices match/); assert.match(html, /Selected outside this filter/);
 filter(h, "x".repeat(81)); assert.equal(preview(h), json); assert.equal(options(h).length, 1); assert.equal(options(h, "period").length, 0);
 assert.match(renderToStaticMarkup(h.render()), /Reference search is invalid/);
 button(h, "Show all reference choices").props.onClick(); assert.equal(options(h).length, 2); assert.equal(preview(h), json); h.unmount();
});
test("choosing another filtered reference retains the existing outside-filter occurrence and exact original reference numbers", () => {
 const h = scopeDraftHarness(context()); h.mount(); prepare(h); filter(h, "contrasting");
 control(h, "select", "-population-references").props.onChange({ currentTarget: { selectedOptions: options(h).map(option => ({ value: option.props.value })) } });
 assert.equal(preview(h), undefined); button(h, "Review scope draft").props.onClick();
 assert.deepEqual(JSON.parse(preview(h)).fields.population.references.map(ref => ref.referenceNumber), [1, 2]);
 filter(h, "nothing matches"); assert.equal(options(h).length, 2); assert.equal(options(h, "period").length, 0); h.unmount();
});
test("old clear callbacks cannot remove a newer search and context replacement resets search before old handlers dispatch", () => {
 const ctx = context(), h = scopeDraftHarness(ctx); h.mount(); filter(h, "contrasting");
 const oldClear = button(h, "Show all reference choices").props.onClick, oldInput = control(h, "input", "-reference-search").props.onChange;
 filter(h, "supports"); oldClear(); assert.equal(control(h, "input", "-reference-search").props.value, "supports");
 const next = structuredClone(ctx); next.binding.comparisonSha256 = "c".repeat(64); h.render(next); oldInput({ currentTarget: { value: "contrasting" } });
 assert.equal(control(h, "input", "-reference-search").props.value, ""); h.commit();
 assert.equal(control(h, "input", "-reference-search").props.value, ""); h.unmount(); oldClear();
});
test("searching during a native File read changes presentation only and keeps the current file result and selected choice visible", async () => {
 const ctx = context(), h = scopeDraftHarness(ctx); h.mount();
 const candidate = { schemaVersion: 1, kind: "issue_scope_preparation", binding: ctx.binding,
  fields: { population: { wording: "Invented reopened scope", references: [{ claimId: proposalId(3), referenceNumber: 1 }] }, period: null, selectionRationale: null } };
 const bytes = new TextEncoder().encode(scopeDraftJson(candidate, ctx)); let resolve;
 const pending = new Promise(yes => { resolve = yes; });
 const input = { value: "PRIVATE_FILE", files: [{ size: bytes.length, slice() { return { arrayBuffer: () => pending }; } }] };
 control(h, "input", "-file").props.onChange({ currentTarget: input }); filter(h, "contrasting"); resolve(bytes.buffer);
 for (let i = 0; i < 8; i++) await new Promise(yes => setImmediate(yes));
 assert.deepEqual(JSON.parse(preview(h)), candidate); assert.equal(control(h, "input", "-reference-search").props.value, "contrasting");
 assert.equal(options(h).length, 2); assert.match(renderToStaticMarkup(h.render()), /Selected outside this filter/); h.unmount();
});
