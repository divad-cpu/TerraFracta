import assert from "node:assert/strict";
import test from "node:test";
import { sharedViewModule } from "./helpers/shared_view_module.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
const createModule = () => sharedViewModule(new URL("../src/issue-scope-draft-view.tsx", import.meta.url), "IssueScopeDraftView");
const field = (h, suffix) => h.nodes().find(n => n.props.id?.endsWith(suffix)).props;
const picker = h => field(h, "-file");
const button = (h, text) => h.nodes().find(n => n.type === "button" && n.props.children === text).props.onClick;
const flush = () => new Promise(resolve => setImmediate(resolve));
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
const choose = (h, file) => picker(h).onChange({ currentTarget: { files: [file], value: "PRIVATE_SELECTION_PATH" } });
function nativePending(text, t) {
  const bytes = new TextEncoder().encode(text), file = new File([text], "PRIVATE_FILE_NAME.json"), slice = file.slice;
  let settle, reads = 0; const pending = new Promise(resolve => { settle = resolve; });
  Object.defineProperty(file, "slice", { value(...args) { const blob = Reflect.apply(slice, file, args);
    Object.defineProperty(blob, "arrayBuffer", { value() { reads++; return pending; } }); return blob; } });
  const finish = () => settle(bytes.buffer); t.after(async () => { finish(); await flush(); });
  return { file, finish, get reads() { return reads; } };
}

test("scope reserves one same-capture physical slot before native controller constructor reentry", async t => {
  const c = packetContext(), create = createModule(), outer = create({ context: c }), peer = create({ context: c }); outer.commit();
  const a = nativePending(packetParts(c).scope, t), b = nativePending(packetParts(c).scope, t); t.after(() => { outer.unmount(); peer.unmount(); });
  const Native = AbortController; let reentered = false;
  const ctor = t.mock.method(globalThis, "AbortController", function () { const controller = new Native(); if (!reentered) { reentered = true; peer.commit(); choose(peer, b.file); } return controller; });
  choose(outer, a.file); ctor.mock.restore(); const actualReads = a.reads + b.reads; a.finish(); b.finish(); await flush();
  assert.equal(actualReads, 1); assert.equal(picker(outer).disabled, false); assert.equal(picker(peer).disabled, false);
});

test("scope constructor-time Clear denies all retired File byte dispatch", async t => {
  const c = packetContext(), h = createModule()({ context: c }); h.commit(); const f = nativePending(packetParts(c).scope, t); t.after(() => h.unmount());
  const Native = AbortController; let reentered = false;
  const ctor = t.mock.method(globalThis, "AbortController", function () { const value = new Native(); if (!reentered) { reentered = true; button(h, "Clear scope draft")(); } return value; });
  choose(h, f.file); ctor.mock.restore(); const actualReads = f.reads; f.finish(); await flush();
  assert.equal(reentered, true); assert.equal(actualReads, 0); assert.equal(output(h), undefined); assert.equal(picker(h).disabled, false);
});

test("a failed scope controller constructor releases its reservation and waiting visit without an implicit read", async t => {
  const c = packetContext(), create = createModule(), outer = create({ context: c }), peer = create({ context: c }); outer.commit();
  const a = nativePending(packetParts(c).scope, t), b = nativePending(packetParts(c).scope, t); t.after(() => { outer.unmount(); peer.unmount(); });
  const ctor = t.mock.method(globalThis, "AbortController", function () { peer.commit(); throw new Error("PRIVATE_CONTROLLER_FAULT"); });
  choose(outer, a.file); ctor.mock.restore(); await flush(); assert.equal(a.reads + b.reads, 0); assert.equal(picker(peer).disabled, false);
  assert.doesNotMatch(outer.html(), /PRIVATE_CONTROLLER_FAULT/); choose(peer, b.file); assert.equal(b.reads, 1); b.finish(); await flush(); assert.equal(output(peer), packetParts(c).scope);
});

for (const port of ["currentTarget", "files", "index", "reset"]) test(`scope selection ${port} fault stays opaque and preserves unfinished typed material`, async () => {
  const c = packetContext(), h = createModule()({ context: c }); h.commit(); field(h, "-population-wording").onChange({ currentTarget: { value: "Retained unfinished wording" } });
  const fail = () => { throw new Error("PRIVATE_EVENT_FAULT"); }, input = { files: [], value: "" }, event = { currentTarget: input };
  if (port === "currentTarget") Object.defineProperty(event, "currentTarget", { get: fail });
  if (port === "files") Object.defineProperty(input, "files", { get: fail });
  if (port === "index") input.files = Object.defineProperty({}, "0", { get: fail });
  if (port === "reset") Object.defineProperty(input, "value", { set: fail });
  assert.doesNotThrow(() => picker(h).onChange(event)); await flush(); assert.equal(field(h, "-population-wording").value, "Retained unfinished wording");
  assert.match(h.html(), /could not be checked/); assert.doesNotMatch(h.html(), /PRIVATE_EVENT_FAULT/); assert.equal(output(h), undefined); h.unmount();
});

for (const port of ["currentTarget", "files", "index", "reset"]) test(`scope selection stops later property observations after Clear in ${port}`, async t => {
  const c = packetContext(), h = createModule()({ context: c }); h.commit(); const f = nativePending(packetParts(c).scope, t); t.after(() => h.unmount());
  const counts = { currentTarget: 0, files: 0, index: 0, reset: 0 }; let cleared = false;
  const observe = key => { counts[key]++; if (!cleared && key === port) { cleared = true; button(h, "Clear scope draft")(); } };
  const files = Object.defineProperty({}, "0", { get() { observe("index"); return f.file; } });
  const input = { get files() { observe("files"); return files; }, set value(_) { observe("reset"); } };
  picker(h).onChange({ get currentTarget() { observe("currentTarget"); return input; } });
  const order = Object.keys(counts), last = order.indexOf(port);
  assert.deepEqual(Object.values(counts), order.map((_, index) => index <= last ? 1 : 0)); assert.equal(cleared, true); assert.equal(f.reads, 0); f.finish(); await flush();
});

for (const port of ["size", "slice.lookup", "slice.call", "arrayBuffer.lookup", "arrayBuffer.call"]) test(`scope ownership surrounds File ${port} and retains any already invoked physical read`, async t => {
  const c = packetContext(), h = createModule()({ context: c }); h.commit(); const bytes = new TextEncoder().encode(packetParts(c).scope);
  let settle, reads = 0, cleared = false; const pending = new Promise(resolve => { settle = resolve; });
  const observe = name => { if (!cleared && name === port) { cleared = true; button(h, "Clear scope draft")(); } };
  const file = { get size() { observe("size"); return bytes.byteLength; }, get slice() { observe("slice.lookup"); return function () {
    observe("slice.call"); return { get arrayBuffer() { observe("arrayBuffer.lookup"); return function () { reads++; observe("arrayBuffer.call"); return pending; }; } };
  }; } };
  t.after(async () => { settle(bytes.buffer); await flush(); h.unmount(); });
  choose(h, file); assert.equal(cleared, true); assert.equal(reads, port === "arrayBuffer.call" ? 1 : 0);
  if (port === "arrayBuffer.call") assert.equal(picker(h).disabled, true);
  settle(bytes.buffer); await flush(); assert.equal(picker(h).disabled, false); assert.equal(output(h), undefined);
});

test("scope Clear cannot discard newer wording admitted synchronously by native File cancellation", async t => {
  const c = packetContext(), h = createModule()({ context: c }); h.commit(); const f = nativePending(packetParts(c).scope, t); t.after(() => h.unmount());
  const Native = AbortController; let outer;
  const ctor = t.mock.method(globalThis, "AbortController", function () { const value = new Native(); outer ??= value; return value; }); choose(h, f.file); ctor.mock.restore();
  const abort = outer.abort; let reentered = false;
  Object.defineProperty(outer, "abort", { value(...args) { if (!reentered) { reentered = true; field(h, "-population-wording").onChange({ currentTarget: { value: "Newer retained wording" } }); } return Reflect.apply(abort, outer, args); } });
  button(h, "Clear scope draft")(); assert.equal(reentered, true); assert.equal(field(h, "-population-wording").value, "Newer retained wording");
  assert.equal(picker(h).disabled, true); f.finish(); await flush(); assert.equal(field(h, "-population-wording").value, "Newer retained wording"); assert.equal(output(h), undefined);
});
