import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { scopeDraftJson, SCOPE_DRAFT_BYTES } from "../src/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const context = () => capturedScopeDraftContext(proposalReport());
const candidate = (ctx, wording = "Invented file scope") => ({ schemaVersion: 1, kind: "issue_scope_preparation", binding: ctx.binding, fields: { population: { wording, references: [{ claimId: ctx.claims[0].id, referenceNumber: 2 }] }, period: null, selectionRationale: null } });
const field = (h, tag, suffix) => h.nodes().find(row => row.type === tag && row.props.id?.endsWith(suffix));
const button = (h, label) => h.nodes().find(row => row.type === "button" && row.props.children === label);
const preview = h => h.nodes().find(row => row.type === "textarea" && row.props.readOnly)?.props.value;
function choose(h, file) { const input = { files: file ? [file] : [], value: "PRIVATE_FILENAME" }; field(h, "input", "-file").props.onChange({ currentTarget: input }); assert.equal(input.value, ""); }
function delayed(ctx, wording = "Invented delayed scope") { const body = new TextEncoder().encode(scopeDraftJson(candidate(ctx, wording), ctx)); let resolve; const pending = new Promise(yes => { resolve = yes; }); let reads = 0;
 return { get reads() { return reads; }, resolve: () => resolve(body.buffer), file: { size: body.length, slice(start, end) { assert.equal(start, 0); assert.equal(end, SCOPE_DRAFT_BYTES + 1); return { arrayBuffer() { reads++; return pending; } }; } } };
}
test("actual native File opens locally into editable fields and exact references without filename or network dispatch", async t => {
 t.mock.method(globalThis, "fetch", () => assert.fail("Network dispatched"));
 const ctx = context(), h = scopeDraftHarness(ctx); h.mount(); choose(h, new File([scopeDraftJson(candidate(ctx), ctx)], "PRIVATE_FILENAME.json")); await tick();
 assert.equal(JSON.parse(preview(h)).fields.population.wording, "Invented file scope");
 assert.deepEqual(field(h, "select", "-population-references").props.value, [`${proposalId(3)}:2`]);
 const html = renderToStaticMarkup(h.render()); assert.match(html, /Local preparation file opened/); assert.doesNotMatch(html, /PRIVATE_FILENAME|<form|href="https:/); h.unmount();
});
test("oversize unreadable invalid and mismatched files immediately withhold prior editing and preview", async () => {
 const ctx = context(), h = scopeDraftHarness(ctx); h.mount(); choose(h, new File([scopeDraftJson(candidate(ctx), ctx)], "PRIVATE_FILENAME")); await tick(); assert.ok(preview(h));
 let slices = 0; choose(h, { size: SCOPE_DRAFT_BYTES + 1, slice() { slices++; assert.fail("Oversize dispatch"); } }); await tick(); assert.equal(slices, 0); assert.equal(preview(h), undefined);
 assert.equal(field(h, "textarea", "-population-wording").props.value, "");
 for (const file of [new File(["{PRIVATE_CANARY"], "PRIVATE_FILENAME"), { size: 2, slice() { throw Error("PRIVATE_PATH"); } }, new File([scopeDraftJson(candidate({ ...ctx, binding: { ...ctx.binding, comparisonSha256: "c".repeat(64) } }), { ...ctx, binding: { ...ctx.binding, comparisonSha256: "c".repeat(64) } })], "PRIVATE_FILENAME")]) {
  choose(h, file); await tick(); const html = renderToStaticMarkup(h.render()); assert.equal(preview(h), undefined); assert.match(html, /could not be checked/); assert.doesNotMatch(html, /PRIVATE_CANARY|PRIVATE_FILENAME|PRIVATE_PATH/);
 }
 h.unmount();
});
test("replacement or clear retains the prior physical file slot until settlement and starts no implicit retry", async () => {
 const ctx = context(), h = scopeDraftHarness(ctx), first = delayed(ctx), second = delayed(ctx, "Invented second scope"); h.mount();
 choose(h, first.file); choose(h, second.file); assert.equal(first.reads, 1); assert.equal(second.reads, 0); assert.match(renderToStaticMarkup(h.render()), /still finishing/);
 first.resolve(); await tick(); assert.equal(second.reads, 0); assert.equal(preview(h), undefined); assert.match(renderToStaticMarkup(h.render()), /Choose the file again/);
 choose(h, second.file); button(h, "Clear scope draft").props.onClick(); assert.ok(field(h, "input", "-file").props.disabled); second.resolve(); await tick(); assert.equal(preview(h), undefined); assert.equal(field(h, "textarea", "-population-wording").props.value, "");
 choose(h, new File([scopeDraftJson(candidate(ctx, "Invented fresh scope"), ctx)], "PRIVATE_FILENAME")); await tick(); assert.equal(JSON.parse(preview(h)).fields.population.wording, "Invented fresh scope"); h.unmount();
});
test("new editing review or paste actions retire an unfinished file result before it can overwrite newer local work", async () => {
 const ctx = context(), h = scopeDraftHarness(ctx); h.mount();
 for (const kind of ["editing", "review", "paste"]) {
  const input = delayed(ctx); choose(h, input.file);
  if (kind === "editing") field(h, "textarea", "-population-wording").props.onChange({ currentTarget: { value: "Invented newer editing" } });
  if (kind === "review") button(h, "Review scope draft").props.onClick();
  if (kind === "paste") field(h, "textarea", "-reopen-json").props.onChange({ currentTarget: { value: "{}" } });
  input.resolve(); await tick();
  if (kind === "review") assert.equal(JSON.parse(preview(h)).fields.population, null); else assert.equal(preview(h), undefined);
  if (kind === "editing") assert.equal(field(h, "textarea", "-population-wording").props.value, "Invented newer editing");
 }
 h.unmount();
});
test("changed comparison and unmount reject an old file completion and old file-selector callbacks", async () => {
 const ctx = context(), h = scopeDraftHarness(ctx), first = delayed(ctx); h.mount();
 const old = field(h, "input", "-file").props.onChange; choose(h, first.file);
 const next = structuredClone(ctx); next.binding.comparisonSha256 = "c".repeat(64); h.render(next); h.commit();
 let slices = 0; old({ currentTarget: { files: [{ size: 2, slice() { slices++; assert.fail("Old handler dispatch"); } }], value: "PRIVATE_FILENAME" } }); assert.equal(slices, 0);
 first.resolve(); await tick(); assert.equal(preview(h), undefined); assert.equal(field(h, "textarea", "-population-wording").props.value, "");
 const late = delayed(next); choose(h, late.file); h.unmount(); late.resolve(); await tick(); assert.equal(preview(h), undefined);
});
test("an expired file deadline shows refusal but keeps the physical slot and never applies its late bytes", async t => {
 let clock = 0, expire; t.mock.method(performance, "now", () => clock);
 const nativeSetTimeout = globalThis.setTimeout; t.mock.method(globalThis, "setTimeout", (callback, ms, ...rest) => ms === 8000 ? (expire = callback, { synthetic: true }) : nativeSetTimeout(callback, ms, ...rest));
 const nativeClearTimeout = globalThis.clearTimeout; t.mock.method(globalThis, "clearTimeout", timer => timer?.synthetic ? undefined : nativeClearTimeout(timer));
 const ctx = context(), h = scopeDraftHarness(ctx), first = delayed(ctx), second = delayed(ctx); h.mount(); choose(h, first.file); clock = 8000; expire();
 assert.match(renderToStaticMarkup(h.render()), /could not be checked/); assert.ok(field(h, "input", "-file").props.disabled);
 choose(h, second.file); assert.equal(second.reads, 0); first.resolve(); await tick(); assert.equal(preview(h), undefined); assert.equal(second.reads, 0); h.unmount();
});
