import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeDraftHarness } from "./helpers/scope_draft_harness.mjs";
import { capturedScopeDraftContext } from "../src/server/issue-scope-draft.ts";
import { readScopeDraftFile } from "../src/issue-scope-file.ts";
import { scopeDraftJson } from "../src/issue-scope-draft.ts";
import { proposalReport, proposalId } from "./helpers/proposal_fixture.mjs";
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const field = (h, tag, suffix) => h.nodes().find(row => row.type === tag && row.props.id?.endsWith(suffix));
const button = (h, label) => h.nodes().find(row => row.type === "button" && row.props.children === label);
const preview = h => h.nodes().find(row => row.type === "textarea" && row.props.readOnly)?.props.value;
function ready(wording = "Invented æ scope") {
  const context = capturedScopeDraftContext(proposalReport()), codes = [], h = scopeDraftHarness(context, code => codes.push(code)); h.mount();
  field(h, "textarea", "-population-wording").props.onChange({ currentTarget: { value: wording } });
  field(h, "select", "-population-references").props.onChange({ currentTarget: { selectedOptions: [{ value: `${proposalId(3)}:2` }] } });
  button(h, "Review scope draft").props.onClick();
  return { h, context, codes, action: () => button(h, "Download scope preparation")?.props.onClick };
}
function ports(t, mutate = () => {}) {
  const calls = [], blobs = [], links = [];
  const link = { href: "", download: "", click() { calls.push("click"); mutate("click"); }, remove() { calls.push("remove"); mutate("remove"); } };
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => { if (prior) Object.defineProperty(globalThis, "document", prior); else delete globalThis.document; });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement(tag) { assert.equal(tag, "a"); calls.push("create"); links.push(link); mutate("create"); return link; }, body: { append(value) { assert.equal(value, link); calls.push("append"); mutate("append"); } } } });
  t.mock.method(URL, "createObjectURL", blob => { calls.push("url"); blobs.push(blob); mutate("url"); return "blob:scope-test"; });
  t.mock.method(URL, "revokeObjectURL", value => { assert.equal(value, "blob:scope-test"); calls.push("revoke"); mutate("revoke"); });
  t.mock.method(globalThis, "fetch", () => assert.fail("No upload or network operation permitted"));
  return { calls, blobs, links };
}
test("checked scope preview downloads exact bounded UTF-8 and reopens through the actual File view without a publication payload", async t => {
  const ui = ready(), native = ports(t), json = preview(ui.h);
  assert.equal(typeof ui.action(), "function", "Missing local scope export control");
  ui.action()(); assert.deepEqual(native.calls, ["create", "url", "append", "click", "remove", "revoke"]);
  assert.equal(native.links[0].download, "terrafracta-scope-preparation.json"); assert.equal(native.blobs[0].type, "application/json");
  const bytes = await native.blobs[0].arrayBuffer(); assert.equal(new TextDecoder().decode(bytes), json);
  const candidate = readScopeDraftFile(bytes, bytes.byteLength, ui.context); assert.equal(candidate.kind, "issue_scope_preparation"); assert.equal(candidate.fields.population.references[0].referenceNumber, 2);
  button(ui.h, "Clear scope draft").props.onClick();
  const input = { files: [new File([bytes], "PRIVATE_FILENAME")], value: "PRIVATE_FILENAME" }; field(ui.h, "input", "-file").props.onChange({ currentTarget: input }); await tick();
  assert.equal(input.value, ""); assert.equal(preview(ui.h), json); assert.deepEqual(ui.codes, []);
  const html = renderToStaticMarkup(ui.h.render()); assert.doesNotMatch(html, /PRIVATE_FILENAME|<form|href="https:/); assert.match(html, /local file/); ui.h.unmount();
});
test("retired export actions cannot allocate after editing clear changed capture or unmount", t => {
  const native = ports(t);
  for (const change of [ui => field(ui.h, "textarea", "-population-wording").props.onChange({ currentTarget: { value: "New wording" } }),
    ui => button(ui.h, "Clear scope draft").props.onClick(),
    ui => ui.h.render({ ...ui.context, binding: { ...ui.context.binding, captureId: proposalId(99) } }),
    ui => ui.h.unmount()]) {
    const ui = ready(), action = ui.action(); assert.equal(typeof action, "function"); change(ui); action(); assert.deepEqual(native.calls, []); assert.deepEqual(ui.codes, []); ui.h.unmount();
  }
});
test("combined UTF-8 overflow withholds the preview and download without a diagnostic and permits explicit recovery", t => {
  const context = capturedScopeDraftContext(proposalReport()), claim = context.claims.find(row => row.id === proposalId(3));
  // Finite invented client choices: twelve bounded occurrences, no source qualification.
  claim.evidence = Array.from({ length: 12 }, () => ({ ...claim.evidence[0] }));
  const wording = "\u0001".repeat(200) + "界".repeat(1000);
  const codes = [], h = scopeDraftHarness(context, code => codes.push(code)); h.mount(); const native = ports(t);
  for (const name of ["population", "period", "selectionRationale"]) {
    field(h, "textarea", `-${name}-wording`).props.onChange({ currentTarget: { value: wording } });
    field(h, "select", `-${name}-references`).props.onChange({ currentTarget: { selectedOptions: Array.from({ length: 12 }, (_, index) => ({ value: `${claim.id}:${index + 1}` })) } });
  }
  button(h, "Review scope draft").props.onClick();
  assert.equal(scopeDraftJson({ schemaVersion: 1, kind: "issue_scope_preparation", binding: context.binding,
    fields: Object.fromEntries(["population", "period", "selectionRationale"].map(name => [name, {
      wording, references: Array.from({ length: 12 }, (_, index) => ({ claimId: claim.id, referenceNumber: index + 1 })),
    }])) }, context), null, "The accepted per-field grammar must actually exceed the combined byte budget");
  assert.equal(button(h, "Download scope preparation"), undefined); assert.equal(preview(h), undefined);
  assert.match(renderToStaticMarkup(h.render()), /complete preparation exceeds the 16 KiB UTF-8 export limit/);
  assert.deepEqual(native.calls, []); assert.deepEqual(codes, []);
  assert.equal(field(h, "textarea", "-population-wording").props.value, wording);
  for (const name of ["population", "period", "selectionRationale"])
    field(h, "textarea", `-${name}-wording`).props.onChange({ currentTarget: { value: "Short invented wording" } });
  button(h, "Review scope draft").props.onClick(); assert.equal(typeof button(h, "Download scope preparation").props.onClick, "function");
  button(h, "Download scope preparation").props.onClick(); assert.ok(native.calls.includes("click")); assert.deepEqual(codes, []); h.unmount();
});
for (const phase of ["create", "url", "append"])
  test(`scope retirement during ${phase} denies download and releases allocated native resources`, t => {
    const ui = ready(), native = ports(t, at => { if (at === phase) button(ui.h, "Clear scope draft").props.onClick(); });
    assert.equal(typeof ui.action(), "function"); ui.action()(); assert.ok(!native.calls.includes("click")); assert.ok(native.calls.includes("remove"));
    assert.equal(native.calls.includes("revoke"), phase !== "create"); assert.deepEqual(ui.codes, []); assert.equal(preview(ui.h), undefined); ui.h.unmount();
  });
for (const phase of ["create", "url", "append", "click"])
  test(`caught scope export ${phase} fault preserves the preview and reports only the fixed code`, t => {
    const ui = ready("PRIVATE_WORDING"), original = preview(ui.h), native = ports(t, at => { if (at === phase) throw Error("PRIVATE_EXCEPTION"); });
    assert.equal(typeof ui.action(), "function"); assert.doesNotThrow(() => ui.action()());
    assert.equal(preview(ui.h), original); assert.deepEqual(ui.codes, ["scope_draft_export"]);
    const html = renderToStaticMarkup(ui.h.render()); assert.match(html, /could not be downloaded/); assert.doesNotMatch(html, /PRIVATE_EXCEPTION/);
    assert.equal(native.calls.filter(value => value === "click").length, phase === "click" ? 1 : 0); ui.h.unmount();
  });
test("cleanup refusal preserves requested outcome and does not retry or create a diagnostic", t => {
  const ui = ready(), native = ports(t, at => { if (at === "remove" || at === "revoke") throw Error("PRIVATE_CLEANUP"); });
  assert.equal(typeof ui.action(), "function"); assert.doesNotThrow(() => ui.action()());
  assert.deepEqual(native.calls, ["create", "url", "append", "click", "remove", "revoke"]); assert.deepEqual(ui.codes, []);
  assert.match(renderToStaticMarkup(ui.h.render()), /Download requested/); ui.h.unmount();
});
