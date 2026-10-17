import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetFileHarnessFactory } from "./helpers/packet_file_shared_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson, PREPARATION_PACKET_BYTES } from "../src/preparation-packet.ts";
import { proposalId } from "./helpers/proposal_fixture.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/preparation-packet-view.tsx", import.meta.url), name: "PreparationPacketView" });
const flush = () => new Promise(resolve => setImmediate(resolve));
const button = (h, text) => h.nodes().find(node => node.type === "button" && node.props.children === text) ?? assert.fail(text);
const click = (h, text) => button(h, text).props.onClick();
const picker = h => h.nodes().find(node => node.type === "input" && node.props.type === "file");
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const part = (h, name = "scope") => h.nodes().find(node => node.props.id?.endsWith(`-part-${name}`));
const input = (h, name, value) => part(h, name).props.onChange({ currentTarget: { value } });
const sample = () => { const context = packetContext(), parts = packetParts(context), packet = preparationPacketFromParts(parts, context), json = preparationPacketJson(packet, context); return { context, parts, packet, json }; };
function select(h, file) { const target = { files: file ? [file] : [], value: "PRIVATE_LOCAL_PATH" }; picker(h).props.onChange({ currentTarget: target }); assert.equal(target.value, ""); }
function pendingFile(json, t) {
  let resolve, reject, calls = 0; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  t.after(async () => { resolve(new TextEncoder().encode(json).buffer); await flush(); });
  const file = { size: new TextEncoder().encode(json).byteLength, slice(start, end) {
    assert.equal(this, file); assert.equal(start, 0); assert.equal(end, PREPARATION_PACKET_BYTES + 1);
    const blob = { arrayBuffer() { assert.equal(this, blob); calls++; return promise; } }; return blob;
  } };
  return { file, finish: () => resolve(new TextEncoder().encode(json).buffer), fail: () => reject(Error("PRIVATE_FILE_FAILURE")), calls: () => calls };
}
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));

test("explicit native File reopening installs all six parts atomically and never observes or displays its filename", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); const file = new File([s.json], "PRIVATE_FILENAME.json", { type: "application/json" });
  Object.defineProperty(file, "name", { get() { assert.fail("Filename was observed"); } });
  select(h, file); assert.equal(output(h), undefined); await flush();
  assert.equal(output(h), s.json); for (const [name, value] of Object.entries(s.parts)) assert.equal(part(h, name).props.value, value);
  const html = renderToStaticMarkup(h.render()); assert.match(html, /Exact local preparation packet checked/); assert.doesNotMatch(html, /PRIVATE_FILENAME|PRIVATE_LOCAL_PATH/); h.unmount();
});
test("malformed UTF8 BOM wrong size and foreign binding hold a file without erasing typed preparations", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); input(h, "scope", s.parts.scope);
  const foreign = structuredClone(s.packet); foreign.binding.captureId = proposalId(297);
  for (const body of ["PRIVATE_NOT_JSON", "\ufeff" + s.json, JSON.stringify(foreign, null, 2), Uint8Array.of(0xc3, 0x28)]) {
    select(h, new File([body], "PRIVATE_NAME.json")); await flush(); assert.equal(output(h), undefined); assert.equal(part(h).props.value, s.parts.scope);
    const html = renderToStaticMarkup(h.render()); assert.match(html, /Local packet file held/); assert.doesNotMatch(html, /PRIVATE_NOT_JSON|PRIVATE_NAME/);
  }
  select(h, { size: 1, get slice() { assert.fail("Rejected size dispatched a read"); } }); await flush(); assert.equal(part(h).props.value, s.parts.scope); h.unmount();
});
test("newer edits and clear logically retire a pending file while its physical slot remains owned until settlement", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); const pending = pendingFile(s.json, t); select(h, pending.file); assert.equal(pending.calls(), 1);
  input(h, "scope", s.parts.scope); assert.equal(picker(h).props.disabled, true); click(h, "Clear preparation packet");
  const forbidden = { get size() { assert.fail("Second read observed metadata"); } };
  select(h, forbidden); assert.equal(pending.calls(), 1); pending.finish(); await flush();
  assert.equal(output(h), undefined); assert.equal(part(h).props.value, ""); assert.equal(picker(h).props.disabled, false);
  select(h, new File([s.json], "private.json")); await flush(); assert.equal(output(h), s.json); h.unmount();
});
test("a fresh mount waits for the same capture's unresolved predecessor and requires explicit reselection after physical settlement", async t => {
  noNetwork(t); const s = sample(), create = packetFileHarnessFactory(), old = create(s.context); old.mount(); const pending = pendingFile(s.json, t); select(old, pending.file); old.unmount();
  const next = create(s.context); next.mount(); assert.equal(picker(next).props.disabled, true); assert.match(renderToStaticMarkup(next.render()), /previous local packet read is still settling/);
  picker(next).props.onChange(new Proxy({}, { get() { assert.fail("Unadmitted successor observed event"); } }));
  pending.finish(); await flush(); assert.equal(output(next), undefined); assert.equal(picker(next).props.disabled, false);
  select(next, new File([s.json], "private.json")); await flush(); assert.equal(output(next), s.json); next.unmount();
});
test("capture replacement denies old handlers before event access and never installs the previous capture's pending file", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); const pending = pendingFile(s.json, t), old = picker(h).props.onChange;
  select(h, pending.file); const next = structuredClone(s.context); next.binding.captureId = proposalId(296); h.render(next);
  old(new Proxy({}, { get() { assert.fail("Retired picker observed event"); } })); h.commit(); h.render(next);
  pending.finish(); await flush(); assert.equal(output(h), undefined); assert.equal(part(h).props.value, ""); h.unmount();
});
test("dispatch-time ownership after size slice and arrayBuffer lookup blocks later work, preserving the actual method receivers", async t => {
  noNetwork(t); const s = sample();
  for (const stage of ["size", "slice", "arrayBuffer"]) {
    const h = harness(s.context); h.mount(); let called = 0; const retire = () => { input(h, "scope", "NEWER_TYPED_INTENT"); };
    const blob = { get arrayBuffer() { if (stage === "arrayBuffer") retire(); return function () { called++; return Promise.resolve(new TextEncoder().encode(s.json).buffer); }; } };
    const file = { get size() { if (stage === "size") retire(); return new TextEncoder().encode(s.json).byteLength; },
      get slice() { if (stage === "slice") retire(); return function () { assert.equal(this, file); return blob; }; } };
    select(h, file); await flush(); assert.equal(called, 0, stage); assert.equal(part(h).props.value, "NEWER_TYPED_INTENT"); assert.equal(output(h), undefined); h.unmount();
  }
});
test("retirement during an invoked arrayBuffer still awaits physical settlement before admitting a later read", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); let resolve, calls = 0;
  const promise = new Promise(yes => { resolve = yes; });
  select(h, { size: new TextEncoder().encode(s.json).byteLength, slice() { return { arrayBuffer() { calls++; click(h, "Clear preparation packet"); return promise; } }; } });
  assert.equal(calls, 1); assert.equal(picker(h).props.disabled, true);
  select(h, { get size() { assert.fail("Physical slot was released early"); } });
  resolve(new TextEncoder().encode(s.json).buffer); await flush(); assert.equal(output(h), undefined); assert.equal(picker(h).props.disabled, false); h.unmount();
});
test("unavailable controller or rejected native read produces fixed local hold and a later explicit selection can recover", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); const Original = globalThis.AbortController;
  const failure = t.mock.method(globalThis, "AbortController", function () { throw Error("PRIVATE_CONTROLLER"); });
  select(h, { get size() { assert.fail("Unavailable controller dispatched file access"); } }); await flush(); failure.mock.restore(); assert.equal(globalThis.AbortController, Original);
  const pending = pendingFile(s.json, t); select(h, pending.file); pending.fail(); await flush();
  const html = renderToStaticMarkup(h.render()); assert.match(html, /Local packet file held/); assert.doesNotMatch(html, /PRIVATE_CONTROLLER|PRIVATE_FILE_FAILURE/);
  select(h, new File([s.json], "private.json")); await flush(); assert.equal(output(h), s.json); h.unmount();
});
test("picker target retirement does not inspect a later files getter or disturb the newer input", t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); let observed = 0;
  picker(h).props.onChange({ get currentTarget() { input(h, "scope", "NEWER"); return { get files() { observed++; return []; } }; } });
  assert.equal(observed, 0); assert.equal(part(h).props.value, "NEWER"); h.unmount();
});
test("a paste event retires old download authority before a target getter can invoke the previous action", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); select(h, new File([s.json], "private.json")); await flush();
  const download = button(h, "Download private preparation packet").props.onClick;
  const before = Object.getOwnPropertyDescriptor(globalThis, "document"); Object.defineProperty(globalThis, "document", { configurable: true, get() { assert.fail("Old download observed DOM"); } });
  t.after(() => { if (before) Object.defineProperty(globalThis, "document", before); else delete globalThis.document; });
  part(h).props.onChange({ get currentTarget() { download(); return { value: "NEWER" }; } });
  assert.equal(output(h), undefined); assert.equal(part(h).props.value, "NEWER"); h.unmount();
});

test("earlier Clear callbacks cannot replace newer text while a freshly rendered Clear can retire an in-progress getter", t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); const old = button(h, "Clear preparation packet").props.onClick;
  input(h, "scope", "NEWER"); old(); assert.equal(part(h).props.value, "NEWER"); let observed = 0;
  part(h).props.onChange({ get currentTarget() { click(h, "Clear preparation packet"); return { get value() { observed++; return "PRIVATE_OLDER"; } }; } });
  assert.equal(observed, 0); assert.equal(part(h).props.value, ""); h.unmount();
});

test("deadline refusal retains the physical read slot and cannot install late bytes or start an implicit retry", async t => {
  noNetwork(t); let clock = 0, expire; t.mock.method(performance, "now", () => clock);
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => ms === 8_000 ? (expire = callback, { packetTimer: true }) : originalSet(callback, ms, ...args));
  t.mock.method(globalThis, "clearTimeout", timer => timer?.packetTimer ? undefined : originalClear(timer));
  const s = sample(), h = harness(s.context); h.mount(); const pending = pendingFile(s.json, t); select(h, pending.file);
  clock = 8_000; expire(); assert.match(renderToStaticMarkup(h.render()), /Local packet file held/); assert.equal(picker(h).props.disabled, true);
  select(h, { get size() { assert.fail("Expired physical slot dispatched a new read"); } });
  pending.finish(); await flush(); assert.equal(output(h), undefined); assert.equal(picker(h).props.disabled, false); assert.equal(pending.calls(), 1); h.unmount();
});
test("a throwing physical abort cannot restore an obsolete file result or release its occupied slot early", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); const pending = pendingFile(s.json, t), NativeController = globalThis.AbortController;
  let outer;
  t.mock.method(globalThis, "AbortController", function () {
    const controller = new NativeController();
    if (!outer) { outer = controller; t.mock.method(controller, "abort", () => { throw Error("PRIVATE_ABORT_FAULT"); }); }
    return controller;
  });
  select(h, pending.file);
  input(h, "scope", "NEWER_TYPED_TEXT"); assert.equal(picker(h).props.disabled, true);
  select(h, { get size() { assert.fail("Failed abort released physical slot"); } }); pending.finish(); await flush();
  assert.equal(output(h), undefined); assert.equal(part(h).props.value, "NEWER_TYPED_TEXT"); assert.equal(picker(h).props.disabled, false);
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /PRIVATE_ABORT_FAULT/); h.unmount();
});

test("a physical slot is reserved before a native controller constructor can admit another mounted reader", async t => {
  noNetwork(t); const s = sample(), create = packetFileHarnessFactory(), first = create(s.context), second = create(s.context);
  first.mount(); second.mount(); const pending = pendingFile(s.json, t), NativeController = globalThis.AbortController; let entered = false, secondReads = 0;
  const later = { size: new TextEncoder().encode(s.json).byteLength, slice() { return { arrayBuffer() { secondReads++; return Promise.resolve(new TextEncoder().encode(s.json).buffer); } }; } };
  t.mock.method(globalThis, "AbortController", function () {
    if (!entered) { entered = true; select(second, later); }
    return new NativeController();
  });
  select(first, pending.file); assert.equal(pending.calls(), 1); assert.equal(secondReads, 0);
  pending.finish(); await flush(); assert.equal(output(first), s.json); assert.equal(output(second), undefined); assert.equal(secondReads, 0);
  assert.match(renderToStaticMarkup(second.render()), /This file selection did not start because another local packet read owned the slot/);
  select(second, later); await flush(); assert.equal(secondReads, 1); assert.equal(output(second), s.json); first.unmount(); second.unmount();
});

test("constructor setup refusal releases its reservation and admits a waiting fresh mount without retrying a file", async t => {
  noNetwork(t); const s = sample(), create = packetFileHarnessFactory(), first = create(s.context); first.mount(); let second;
  const mock = t.mock.method(globalThis, "AbortController", function () {
    second = create(s.context); second.mount(); assert.equal(picker(second).props.disabled, true); throw Error("PRIVATE_CONSTRUCTOR_FAULT");
  });
  select(first, { get size() { assert.fail("Failed constructor accessed file metadata"); } }); await flush(); mock.mock.restore();
  assert.equal(output(second), undefined); assert.equal(picker(second).props.disabled, false);
  select(second, new File([s.json], "private.json")); await flush(); assert.equal(output(second), s.json); first.unmount(); second.unmount();
});
test("failed deadline setup dispatches no file metadata and a later explicit selection recovers", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context); h.mount(); input(h, "scope", s.parts.scope);
  const original = globalThis.setTimeout, mock = t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    if (ms === 8_000) throw Error("PRIVATE_TIMER_FAULT"); return original(callback, ms, ...args);
  });
  select(h, { get size() { assert.fail("Failed timer setup observed file metadata"); } }); await flush(); mock.mock.restore();
  assert.equal(picker(h).props.disabled, false); assert.equal(part(h).props.value, s.parts.scope); assert.match(renderToStaticMarkup(h.render()), /Local packet file held/);
  select(h, new File([s.json], "private.json")); await flush(); assert.equal(output(h), s.json); h.unmount();
});

function downloadPort(t, click) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "document"), calls = { clicks: 0, removed: 0, revoked: 0, blobs: [] };
  const link = { remove() { calls.removed++; }, click() { calls.clicks++; click?.(); } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => link, body: { append() {} } } });
  t.after(() => { if (before) Object.defineProperty(globalThis, "document", before); else delete globalThis.document; });
  t.mock.method(URL, "createObjectURL", blob => { calls.blobs.push(blob); return "blob:private-packet-native-test"; });
  t.mock.method(URL, "revokeObjectURL", () => { calls.revoked++; }); return { calls, link };
}
test("the explicit UI download requests exact checked bytes and leaves the preview editable with an honest request notice", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context), port = downloadPort(t); h.mount();
  select(h, new File([s.json], "private.json")); await flush(); click(h, "Download private preparation packet");
  assert.equal(output(h), s.json); assert.equal(port.calls.clicks, 1); assert.equal(port.calls.removed, 1); assert.equal(port.calls.revoked, 1);
  assert.equal(await port.calls.blobs[0].text(), s.json); assert.equal(port.link.download, "terrafracta-private-preparation-packet.json");
  const html = renderToStaticMarkup(h.render()); assert.match(html, /Download requested/); assert.match(html, /not confirmation that a file was saved/); h.unmount();
});
test("a failed UI download preserves checked material and shows no exception text or automatic retry", async t => {
  noNetwork(t); const s = sample(), h = harness(s.context), port = downloadPort(t, () => { throw Error("PRIVATE_CLICK_EXCEPTION"); }); h.mount();
  select(h, new File([s.json], "private.json")); await flush(); click(h, "Download private preparation packet");
  assert.equal(output(h), s.json); assert.equal(port.calls.clicks, 1); assert.equal(port.calls.removed, 1); assert.equal(port.calls.revoked, 1);
  const html = renderToStaticMarkup(h.render()); assert.match(html, /download request could not be confirmed/); assert.doesNotMatch(html, /PRIVATE_CLICK_EXCEPTION/);
  h.render(); assert.equal(port.calls.clicks, 1); h.unmount();
});
