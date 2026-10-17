import assert from "node:assert/strict";
import test from "node:test";
import { packetFileHarnessFactory } from "./helpers/packet_file_shared_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
const flush = () => new Promise(resolve => setImmediate(resolve));
const node = (h, type, match) => h.nodes().find(n => n.type === type && match(n)) ?? assert.fail(type);
const button = (h, text) => node(h, "button", n => n.props.children === text).props.onClick;
const scope = h => node(h, "textarea", n => n.props.id?.endsWith("-part-scope")).props;
const picker = h => node(h, "input", n => n.props.type === "file").props;
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;

for (const action of ["clear", "newer part"]) test(`manual inspection stops old JSON parsing after native cancellation reenters ${action}`, async t => {
  const c = packetContext(), parts = packetParts(c), create = packetFileHarnessFactory(), h = create(c), peer = create(c); h.mount();
  scope(h).onChange({ currentTarget: { value: parts.scope } });
  const json = preparationPacketJson(preparationPacketFromParts(parts, c), c), bytes = new TextEncoder().encode(json);
  let settle, reads = 0, controller; const pending = new Promise(resolve => { settle = resolve; });
  const Native = AbortController, capture = t.mock.method(globalThis, "AbortController", function () { const value = new Native(); controller ??= value; return value; });
  picker(h).onChange({ currentTarget: { files: [{ size: bytes.byteLength, slice: () => ({ arrayBuffer() { reads++; return pending; } }) }], value: "" } });
  capture.mock.restore(); assert.equal(reads, 1);
  const abort = controller.abort, parse = JSON.parse; let retired = false, oldParses = 0;
  Object.defineProperty(controller, "abort", { value(...args) {
    if (!retired) { retired = true; if (action === "clear") button(h, "Clear preparation packet")(); else scope(h).onChange({ currentTarget: { value: "NEWER_PRIVATE_PART" } }); }
    return Reflect.apply(abort, controller, args);
  } });
  const parseMock = t.mock.method(JSON, "parse", (text, ...args) => { if (retired && text === parts.scope) oldParses++; return parse(text, ...args); });
  try {
    button(h, "Inspect combined preparation packet")(); assert.equal(retired, true);
    assert.equal(scope(h).value, action === "clear" ? "" : "NEWER_PRIVATE_PART"); assert.equal(output(h), undefined);
    assert.equal(picker(h).disabled, true); h.unmount(); peer.mount(); assert.equal(picker(peer).disabled, true);
  } finally {
    parseMock.mock.restore(); settle(bytes.buffer); await flush(); h.unmount();
    assert.equal(picker(peer).disabled, false); peer.unmount();
  }
  assert.equal(reads, 1); assert.equal(oldParses, 0);
});

test("an abort exception without newer intent still permits current inspection and retains the unresolved physical read", async t => {
  const c = packetContext(), parts = packetParts(c), create = packetFileHarnessFactory(), h = create(c); h.mount();
  scope(h).onChange({ currentTarget: { value: parts.scope } }); const bytes = new TextEncoder().encode(preparationPacketJson(preparationPacketFromParts(parts, c), c));
  let settle, controller; const pending = new Promise(resolve => { settle = resolve; });
  const Native = AbortController, capture = t.mock.method(globalThis, "AbortController", function () { const value = new Native(); controller ??= value; return value; });
  picker(h).onChange({ currentTarget: { files: [{ size: bytes.byteLength, slice: () => ({ arrayBuffer: () => pending }) }], value: "" } }); capture.mock.restore();
  Object.defineProperty(controller, "abort", { value() { throw new Error("PRIVATE_ABORT_ERROR"); } });
  try { button(h, "Inspect combined preparation packet")(); assert.equal(typeof output(h), "string"); assert.equal(picker(h).disabled, true); }
  finally { settle(bytes.buffer); await flush(); assert.equal(picker(h).disabled, false); h.unmount(); }
});
