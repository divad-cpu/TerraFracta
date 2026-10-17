import assert from "node:assert/strict";
import test from "node:test";
import { sharedViewModule } from "./helpers/shared_view_module.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";

const create = () => sharedViewModule(new URL("../src/responsibility-draft-view.tsx", import.meta.url), "ResponsibilityDraftView");
const picker = h => h.nodes().find(n => n.type === "input" && n.props.type === "file").props;
const clear = h => h.nodes().find(n => n.type === "button" && n.props.children === "Clear responsibility draft").props.onClick();
const flush = () => new Promise(resolve => setImmediate(resolve));
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;

for (const port of ["currentTarget", "files", "index", "reset"]) test(`responsibility File selection stops later observations after Clear in ${port}`, async t => {
  const h = create()({ context: packetContext() }); h.commit(); t.after(() => h.unmount());
  const counts = { currentTarget: 0, files: 0, index: 0, reset: 0 }; let cleared = false, reads = 0;
  const observe = key => { counts[key]++; if (!cleared && key === port) { cleared = true; clear(h); } };
  const file = new File(["{}"], "PRIVATE_FILE_NAME.json");
  Object.defineProperty(file, "slice", { value() { reads++; throw new Error("RETIRED_READ"); } });
  const files = Object.defineProperty({}, "0", { get() { observe("index"); return file; } });
  const input = { get files() { observe("files"); return files; }, set value(_) { observe("reset"); } };
  picker(h).onChange({ get currentTarget() { observe("currentTarget"); return input; } });
  const order = Object.keys(counts), last = order.indexOf(port);
  assert.deepEqual(Object.values(counts), order.map((_, index) => index <= last ? 1 : 0));
  await flush(); assert.equal(cleared, true); assert.equal(reads, 0); assert.equal(output(h), undefined);
});

for (const port of ["size", "slice.lookup", "slice.call", "arrayBuffer.lookup", "arrayBuffer.call"]) test(`responsibility ownership surrounds File ${port} and drains an invoked byte read`, async t => {
  const c = packetContext(), h = create()({ context: c }); h.commit(); const bytes = new TextEncoder().encode(packetParts(c).responsibility);
  let settle, reads = 0, slices = 0, cleared = false; const pending = new Promise(resolve => { settle = resolve; });
  const observe = name => { if (!cleared && name === port) { cleared = true; clear(h); } };
  const file = { get size() { observe("size"); return bytes.byteLength; }, get slice() { observe("slice.lookup"); return function () {
    assert.equal(this, file); slices++; observe("slice.call"); const chunk = { get arrayBuffer() { observe("arrayBuffer.lookup"); return function () {
      assert.equal(this, chunk); reads++; observe("arrayBuffer.call"); return pending;
    }; } }; return chunk;
  }; } };
  t.after(async () => { settle(bytes.buffer); await flush(); h.unmount(); });
  picker(h).onChange({ currentTarget: { files: [file], value: "PRIVATE_SELECTION_PATH" } });
  assert.equal(cleared, true); assert.equal(slices, ["size", "slice.lookup"].includes(port) ? 0 : 1);
  assert.equal(reads, port === "arrayBuffer.call" ? 1 : 0);
  if (port === "arrayBuffer.call") assert.equal(picker(h).disabled, true);
  settle(bytes.buffer); await flush(); assert.equal(picker(h).disabled, false); assert.equal(output(h), undefined);
});
