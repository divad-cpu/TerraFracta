import assert from "node:assert/strict";
import test from "node:test";
import { downloadPreparationPacketFile } from "../src/preparation-packet-download.ts";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
const sample = () => { const context = packetContext(), packet = preparationPacketFromParts(packetParts(context), context); return { context, packet }; };
function patch(t, object, key, descriptor) {
  const before = Object.getOwnPropertyDescriptor(object, key); Object.defineProperty(object, key, { configurable: true, ...descriptor });
  t.after(() => { if (before) Object.defineProperty(object, key, before); else delete object[key]; });
}
function port(t, action = () => {}) {
  const state = { active: true, calls: [], blobs: [], removed: 0, revoked: [] }, call = name => { state.calls.push(name); action(name, state); };
  const link = {
    set href(value) { this.assignedHref = value; call("href"); }, set download(value) { this.assignedDownload = value; call("download"); },
    get remove() { call("remove.lookup"); return function () { assert.equal(this, link); state.removed++; call("remove.call"); }; },
    get click() { call("click.lookup"); return function () { assert.equal(this, link); call("click.call"); }; },
  };
  const body = { get append() { call("append.lookup"); return function (value) { assert.equal(this, body); assert.equal(value, link); call("append.call"); }; } };
  const doc = { get createElement() { call("create.lookup"); return function (tag) { assert.equal(this, doc); assert.equal(tag, "a"); call("create.call"); return link; }; },
    get body() { call("body"); return body; } };
  patch(t, globalThis, "document", { get() { call("document"); return doc; } });
  patch(t, URL, "createObjectURL", { get() { call("url.lookup"); return function (blob) { assert.equal(this, URL); state.blobs.push(blob); call("url.call"); return "blob:invented-private-packet"; }; } });
  patch(t, URL, "revokeObjectURL", { get() { call("revoke.lookup"); return function (url) { assert.equal(this, URL); state.revoked.push(url); call("revoke.call"); }; } });
  return { state, link, current: () => state.active };
}
test("explicit native download requests the exact private JSON once with fixed basename and independent resource cleanup", async t => {
  const { context, packet } = sample(), p = port(t), before = structuredClone(packet);
  assert.equal(downloadPreparationPacketFile(packet, context, p.current), "requested");
  assert.equal(p.state.blobs.length, 1); assert.equal(p.state.blobs[0].type, "application/json");
  assert.equal(await p.state.blobs[0].text(), preparationPacketJson(packet, context));
  assert.equal(p.link.assignedDownload, "terrafracta-private-preparation-packet.json");
  assert.equal(p.state.calls.filter(name => name === "click.call").length, 1); assert.equal(p.state.removed, 1);
  assert.deepEqual(p.state.revoked, ["blob:invented-private-packet"]); assert.deepEqual(packet, before);
});
test("invalid and structurally valid oversized packets hold before any DOM or URL allocation", t => {
  const { context, packet } = sample(); patch(t, globalThis, "document", { get() { assert.fail("Held packet touched DOM"); } });
  assert.equal(downloadPreparationPacketFile({}, context, () => true), "held");
  assert.equal(downloadPreparationPacketFile(preparationPacketFromParts(largePacketParts(context), context), context, () => true), "held");
  assert.deepEqual(packet, preparationPacketFromParts(packetParts(context), context));
});
test("a retired action observes neither copied input nor DOM", t => {
  const context = packetContext(); patch(t, globalThis, "document", { get() { assert.fail("Retired action touched DOM"); } });
  const input = new Proxy({}, { get() { assert.fail("Retired action touched preparation"); }, ownKeys() { assert.fail("Retired input enumerated"); } });
  assert.equal(downloadPreparationPacketFile(input, context, () => false), "retired");
});
test("retirement during link allocation still removes the owned handle without allocating a URL", t => {
  const { context, packet } = sample(), p = port(t, (name, state) => { if (name === "create.call") state.active = false; });
  assert.equal(downloadPreparationPacketFile(packet, context, p.current), "retired"); assert.equal(p.state.removed, 1);
  assert.equal(p.state.blobs.length, 0); assert.equal(p.state.calls.includes("url.call"), false);
});
test("retirement during URL allocation still revokes that exact handle and removes its link without dispatching click", t => {
  const { context, packet } = sample(), p = port(t, (name, state) => { if (name === "url.call") state.active = false; });
  assert.equal(downloadPreparationPacketFile(packet, context, p.current), "retired"); assert.equal(p.state.removed, 1);
  assert.deepEqual(p.state.revoked, ["blob:invented-private-packet"]); assert.equal(p.state.calls.includes("click.call"), false);
});
test("retirement from method lookup prevents the later append or click invocation and still cleans independently", async t => {
  for (const stage of ["create.lookup", "append.lookup", "click.lookup"]) await t.test(stage, t => {
    const { context, packet } = sample(), p = port(t, (name, state) => { if (name === stage) state.active = false; });
    assert.equal(downloadPreparationPacketFile(packet, context, p.current), "retired");
    assert.equal(p.state.calls.includes(stage.replace("lookup", "call")), false);
    assert.equal(p.state.removed, stage === "create.lookup" ? 0 : 1);
    assert.equal(p.state.revoked.length, stage === "create.lookup" ? 0 : 1);
  });
});
test("native failures return only a fixed result and preserve original copied material without retries", async t => {
  for (const stage of ["create.call", "url.lookup", "append.call", "click.call"]) await t.test(stage, t => {
    const { context, packet } = sample(), before = structuredClone(packet), p = port(t, name => { if (name === stage) throw Error("PRIVATE_NATIVE_EXCEPTION"); });
    assert.equal(downloadPreparationPacketFile(packet, context, p.current), "failed"); assert.deepEqual(packet, before);
    assert.equal(p.state.calls.filter(name => name === stage).length, 1);
    assert.equal(p.state.revoked.length, ["append.call", "click.call"].includes(stage) ? 1 : 0);
  });
});
test("a failed link removal does not prevent URL revocation or replace the original request result", t => {
  const { context, packet } = sample(), p = port(t, name => { if (name === "remove.call") throw Error("PRIVATE_REMOVE_FAULT"); });
  assert.equal(downloadPreparationPacketFile(packet, context, p.current), "requested"); assert.deepEqual(p.state.revoked, ["blob:invented-private-packet"]);
});
test("a failed URL revocation remains one cleanup attempt and does not retry or infer a saved file", t => {
  const { context, packet } = sample(), p = port(t, name => { if (name === "revoke.call") throw Error("PRIVATE_REVOKE_FAULT"); });
  assert.equal(downloadPreparationPacketFile(packet, context, p.current), "requested");
  assert.equal(p.state.calls.filter(name => name === "revoke.call").length, 1); assert.equal(p.state.removed, 1);
});
test("cleanup capability is captured before allocating an object URL", t => {
  const { context, packet } = sample(), p = port(t, name => { if (name === "revoke.lookup") throw Error("PRIVATE_REVOKE_LOOKUP"); });
  assert.equal(downloadPreparationPacketFile(packet, context, p.current), "failed"); assert.equal(p.state.calls.includes("url.call"), false); assert.equal(p.state.removed, 1);
});
