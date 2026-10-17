import assert from "node:assert/strict";
import test from "node:test";
import { readPreparationPacketFile } from "../src/preparation-packet-file.ts";
import { preparationPacketFromParts, preparationPacketJson, PREPARATION_PACKET_BYTES } from "../src/preparation-packet.ts";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
const bytes = text => new TextEncoder().encode(text);
const sample = () => { const context = packetContext(), packet = preparationPacketFromParts(packetParts(context), context), body = bytes(preparationPacketJson(packet, context)); return { context, packet, body }; };
test("exact six-part native UTF8 packet imports independently of later source buffer mutation", () => {
  const { context, packet, body } = sample(), result = readPreparationPacketFile(body.buffer, body.length, context);
  assert.deepEqual(result, packet); body.fill(0); assert.deepEqual(result, packet);
});
test("intrinsic brand and size refuse lookalikes shared detached or oversized native buffers without reading shadow length", () => {
  const { context, body } = sample(); Object.defineProperty(body.buffer, "byteLength", { get() { assert.fail("Shadow length observed"); } });
  assert.ok(readPreparationPacketFile(body.buffer, body.length, context));
  for (const value of [new SharedArrayBuffer(body.length), body, Object.create(ArrayBuffer.prototype),
    new Proxy({}, { get() { assert.fail("Lookalike observed"); } }), new ArrayBuffer(PREPARATION_PACKET_BYTES + 1)])
    assert.equal(readPreparationPacketFile(value, body.length, context), null);
  const detached = new ArrayBuffer(4); structuredClone(detached, { transfer: [detached] }); assert.equal(readPreparationPacketFile(detached, 4, context), null);
});
test("exact byte quota and expected size do not admit partial aliases or oversized valid-parts expansion", () => {
  const { context, body } = sample();
  for (const size of [0, 1, -1, NaN, Infinity, 1.5, "12", body.length - 1, body.length + 1, PREPARATION_PACKET_BYTES + 1])
    assert.equal(readPreparationPacketFile(body.buffer, size, context), null);
  const packet = preparationPacketFromParts(largePacketParts(context), context), oversized = bytes(JSON.stringify(packet, null, 2));
  assert.ok(oversized.length > PREPARATION_PACKET_BYTES); Object.defineProperty(oversized.buffer, "byteLength", { value: 2 });
  assert.equal(readPreparationPacketFile(oversized.buffer, 2, context), null);
});
test("fatal UTF8 BOM and exact-copy checks refuse repaired Unicode trailing bytes duplicate keys and format substitution", () => {
  const { context, body } = sample(), json = new TextDecoder().decode(body);
  for (const text of ["\ufeff" + json, json + "\n", json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'), packetParts(context).scope]) {
    const input = bytes(text); assert.equal(readPreparationPacketFile(input.buffer, input.length, context), null);
  }
  const malformed = Uint8Array.of(0x7b, 0xc3, 0x28, 0x7d); assert.equal(readPreparationPacketFile(malformed.buffer, malformed.length, context), null);
});
test("changed capture or receipt fingerprint cannot reopen a saved packet even when all visible wording is unchanged", () => {
  const { context, body } = sample();
  for (const key of ["captureId", "comparisonSha256", "proposalSha256"]) {
    const next = structuredClone(context); next.binding[key] = key.endsWith("Sha256") ? "c".repeat(64) : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.equal(readPreparationPacketFile(body.buffer, body.length, next), null);
  }
});
