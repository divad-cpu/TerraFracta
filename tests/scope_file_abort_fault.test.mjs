import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { scopeDraftJson, SCOPE_DRAFT_BYTES } from "../src/issue-scope-draft.ts";
import { proposalReport } from "./helpers/proposal_fixture.mjs";

const turn = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const field = (h, tag, suffix) => h.nodes().find(n => n.type === tag && n.props.id?.endsWith(suffix)).props;
const button = (h, label) => h.nodes().find(n => n.type === "button" && n.props.children === label).props;
const preview = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
const markup = h => renderToStaticMarkup(h.render());
function choose(h, file) {
  const input = { files: [file], value: "PRIVATE_NAME" }; field(h, "input", "-file").onChange({ currentTarget: input }); assert.equal(input.value, "");
}
function fixture(t, fault = true) {
  const NativeController = globalThis.AbortController, ctx = capturedScopeDraftContext(proposalReport());
  const candidate = { schemaVersion: 1, kind: "issue_scope_preparation", binding: ctx.binding,
    fields: { population: { wording: "Invented delayed file scope", references: [{ claimId: ctx.claims[0].id, referenceNumber: 2 }] }, period: null, selectionRationale: null } };
  const body = scopeDraftJson(candidate, ctx), buffer = new TextEncoder().encode(body).buffer;
  const h = scopeDraftHarness(ctx), file = new File([body], "PRIVATE_SCOPE.json"); let outer, aborts = 0, reads = 0, resolve;
  const physical = new Promise(ok => { resolve = ok; });
  t.mock.method(globalThis, "fetch", () => assert.fail("Unsent scope used a transport"));
  t.mock.method(globalThis, "AbortController", function () {
    const controller = new NativeController();
    if (!outer) { outer = controller; if (fault) t.mock.method(controller, "abort", () => { aborts++; throw Error("PRIVATE_SCOPE_ABORT"); }); }
    return controller;
  });
  t.mock.method(file, "slice", (start, end) => { assert.equal(start, 0); assert.equal(end, SCOPE_DRAFT_BYTES + 1); reads++;
    const blob = new Blob([buffer]); t.mock.method(blob, "arrayBuffer", () => physical); return blob;
  });
  t.after(async () => { resolve(buffer); await turn(); h.unmount(); }); h.mount();
  return { h, file, resolve: () => resolve(buffer), fresh: () => new File([body], "PRIVATE_FRESH.json"), outer: () => outer, aborts: () => aborts, reads: () => reads };
}

for (const action of ["edit", "paste", "review", "clear"]) test(`scope ${action} survives abort failure and retains newer local intent after the physical file settles`, async t => {
  const f = fixture(t), { h } = f; choose(h, f.file);
  const act = () => action === "edit" ? field(h, "textarea", "-population-wording").onChange({ currentTarget: { value: "Invented newer editing" } })
    : action === "paste" ? field(h, "textarea", "-reopen-json").onChange({ currentTarget: { value: "{}" } })
      : button(h, action === "review" ? "Review scope draft" : "Clear scope draft").onClick();
  assert.doesNotThrow(act); assert.equal(f.aborts(), 1); assert.equal(f.outer().signal.aborted, false);
  assert.equal(field(h, "input", "-file").disabled, true); assert.equal(f.reads(), 1);
  f.resolve(); await turn(); assert.equal(field(h, "input", "-file").disabled, false);
  if (action === "review") assert.equal(JSON.parse(preview(h)).fields.population, null);
  else assert.equal(preview(h), undefined);
  assert.equal(field(h, "textarea", "-population-wording").value, action === "edit" ? "Invented newer editing" : "");
  if (action === "paste") assert.equal(field(h, "textarea", "-reopen-json").value, "{}");
  assert.doesNotMatch(markup(h), /Invented delayed file scope|PRIVATE_/);
});

test("scope deadline displays refusal despite outer abort failure and keeps ownership until actual settlement", async t => {
  const f = fixture(t), { h } = f, timers = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { assert.equal(delay, 8_000); timers.push(callback); return timers.length; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  choose(h, f.file); timers[0](); assert.equal(f.aborts(), 1); assert.equal(f.outer().signal.aborted, false);
  assert.match(markup(h), /could not be checked/); assert.equal(field(h, "input", "-file").disabled, true);
  f.resolve(); await turn(); assert.equal(preview(h), undefined); assert.equal(field(h, "input", "-file").disabled, false);
  choose(h, f.fresh()); await turn(); timers[0](); assert.equal(JSON.parse(preview(h)).fields.population.wording, "Invented delayed file scope");
  assert.doesNotMatch(markup(h), /PRIVATE_/);
});

test("scope committed cleanup contains outer abort failure and late native bytes never reinstall a retired preview", async t => {
  const f = fixture(t), { h } = f; choose(h, f.file); const oldInput = field(h, "input", "-file").onChange;
  assert.doesNotThrow(() => h.unmount()); assert.equal(f.aborts(), 1);
  oldInput(new Proxy({}, { get() { assert.fail("Retired file callback read its event"); } }));
  f.resolve(); await turn(); assert.equal(preview(h), undefined); assert.doesNotMatch(markup(h), /Invented delayed file scope|PRIVATE_/);
});

test("scope native cancellation preserves the real aborted signal and explicit fresh local reopening", async t => {
  const f = fixture(t, false), { h } = f; choose(h, f.file); button(h, "Clear scope draft").onClick();
  assert.equal(f.outer().signal.aborted, true); assert.equal(field(h, "input", "-file").disabled, true);
  f.resolve(); await turn(); assert.equal(preview(h), undefined); assert.equal(field(h, "input", "-file").disabled, false);
  choose(h, f.fresh()); await turn(); assert.equal(JSON.parse(preview(h)).fields.population.wording, "Invented delayed file scope");
  assert.doesNotMatch(markup(h), /PRIVATE_/);
});
