import assert from "node:assert/strict";
import test from "node:test";
import { preparationPacketFromParts, checkPreparationPacket, preparationPacketJson, reopenPreparationPacketJson,
  inspectPreparationPacket, preparationPacketLabels, PREPARATION_PACKET_BYTES } from "../src/preparation-packet.ts";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
import { publicIssueProjectionSchema } from "../src/public-issue-projection.ts";
const sample = () => { const context = packetContext(), parts = packetParts(context), packet = preparationPacketFromParts(parts, context); assert.ok(packet); return { context, parts, packet }; };
const emptyParts = () => Object.fromEntries(Object.keys(preparationPacketLabels).map(name => [name, null]));

test("one private packet preserves all six exact inner formats without merging or modifying their original bytes", () => {
  const { context, parts, packet } = sample(), before = structuredClone(parts);
  assert.deepEqual(packet.preparations, before); assert.deepEqual(parts, before);
  const json = preparationPacketJson(packet, context), reopened = reopenPreparationPacketJson(json, context);
  assert.deepEqual(reopened, packet); assert.deepEqual(reopened.preparations, before);
  assert.equal(JSON.parse(reopened.preparations.funding).entries[0].fields.amount.value, "-0.000");
  assert.equal(JSON.parse(reopened.preparations.indicators).entries[0].fields.value, null);
});
test("any one part may be supplied while omitted parts stay null and an all-absent envelope is refused", () => {
  const { context, parts } = sample(); assert.equal(preparationPacketFromParts(emptyParts(), context), null);
  for (const name of Object.keys(parts)) {
    const input = { ...emptyParts(), [name]: parts[name] }, packet = preparationPacketFromParts(input, context); assert.ok(packet);
    const rows = inspectPreparationPacket(packet, context); assert.equal(rows.filter(row => row.status === "not_supplied").length, 5);
    assert.equal(rows.find(row => row.part === name).status, "supplied");
  }
});
test("supplied empty entry lists remain distinct from absent parts and supplied unknown fields do not become complete", () => {
  const { context, parts } = sample(), empty = JSON.parse(parts.delivery); empty.entries = []; parts.delivery = JSON.stringify(empty, null, 2);
  const packet = preparationPacketFromParts({ ...emptyParts(), scope: parts.scope, delivery: parts.delivery }, context);
  const rows = inspectPreparationPacket(packet, context);
  assert.deepEqual(rows.find(row => row.part === "delivery"), { part: "delivery", status: "empty", entries: 0, suppliedFields: 0, unknownFields: 0 });
  assert.deepEqual(rows.find(row => row.part === "scope"), { part: "scope", status: "supplied", entries: 1, suppliedFields: 1, unknownFields: 2 });
  assert.deepEqual(rows.find(row => row.part === "funding"), { part: "funding", status: "not_supplied", entries: 0, suppliedFields: 0, unknownFields: 0 });
});
test("inspection counts editing fields in fixed order rather than a readiness score or review result", () => {
  const { context, packet } = sample(), rows = inspectPreparationPacket(packet, context);
  assert.deepEqual(rows.map(row => row.part), ["scope", "responsibility", "policyEvents", "funding", "indicators", "delivery"]);
  assert.deepEqual(rows.map(row => row.suppliedFields), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(rows.map(row => row.unknownFields), [2, 3, 3, 8, 12, 4]);
  assert.doesNotMatch(JSON.stringify(rows), /approved|accepted|eligible|reviewed|complete|percentage|score|publication/);
});
test("every binding member is checked in the envelope and independently in each inner preparation", () => {
  const { context, parts, packet } = sample();
  for (const name of Object.keys(context.binding)) {
    const next = structuredClone(context); next.binding[name] = name.endsWith("Sha256") ? "c".repeat(64) : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.equal(checkPreparationPacket(packet, next), null);
    for (const part of Object.keys(parts)) {
      const changed = JSON.parse(parts[part]); changed.binding[name] = next.binding[name];
      assert.equal(preparationPacketFromParts({ ...parts, [part]: JSON.stringify(changed, null, 2) }, context), null, `${part}.${name}`);
    }
  }
});
test("inner format substitution malformed text and noncanonical aliases fail without changing intact source copies", () => {
  const { context, parts } = sample(), before = structuredClone(parts);
  for (const [target, source] of [["scope", "responsibility"], ["policyEvents", "delivery"], ["funding", "indicators"], ["delivery", "policyEvents"]])
    assert.equal(preparationPacketFromParts({ ...parts, [target]: parts[source] }, context), null);
  for (const part of Object.keys(parts)) for (const value of ["", " ", "PRIVATE_BROKEN", parts[part] + "\n", JSON.stringify(JSON.parse(parts[part])),
    parts[part].replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'), JSON.parse(parts[part])])
    assert.equal(preparationPacketFromParts({ ...parts, [part]: value }, context), null);
  assert.deepEqual(parts, before);
});
test("outer copy is exact and rejects unknown authorization keys raw objects duplicate keys or a public projection role", () => {
  const { context, packet } = sample(), json = preparationPacketJson(packet, context);
  for (const text of [json + "\n", JSON.stringify(packet), json.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
    json.replace('"editorial_preparation_packet"', '"editorial_\\u0070reparation_packet"')]) assert.equal(reopenPreparationPacketJson(text, context), null);
  const next = structuredClone(packet); next.approved = true; assert.equal(checkPreparationPacket(next, context), null);
  const parts = { ...packet.preparations, private: "PRIVATE" }; assert.equal(preparationPacketFromParts(parts, context), null);
  assert.equal(publicIssueProjectionSchema.safeParse(packet).success, false);
});
test("individual copy size and combined UTF8 limits are enforced independently without truncation", () => {
  const { context, parts, packet } = sample();
  assert.equal(preparationPacketFromParts({ ...parts, scope: "x".repeat(16_385) }, context), null);
  assert.equal(reopenPreparationPacketJson(" ".repeat(PREPARATION_PACKET_BYTES + 1), context), null);
  // Inner copies have many independent source locators: none can be promoted
  // past its own exact codec simply because the outer packet has space.
  const inner = JSON.parse(parts.scope); inner.fields.population.wording = "😀".repeat(1200);
  const copied = JSON.stringify(inner, null, 2), out = preparationPacketFromParts({ ...parts, scope: copied }, context);
  assert.ok(out); assert.equal(out.preparations.scope, copied); assert.ok(preparationPacketJson(out, context));
  assert.deepEqual(checkPreparationPacket(packet, context), packet);
});

test("six individually valid exact copies that expand past the outer limit are held without changing any original part", () => {
  const context = packetContext(), parts = largePacketParts(context), packet = preparationPacketFromParts(parts, context), before = structuredClone(parts);
  assert.ok(packet); assert.deepEqual(checkPreparationPacket(packet, context), packet);
  assert.ok(Object.values(parts).every(text => new TextEncoder().encode(text).byteLength <= 16_384));
  const outer = JSON.stringify(packet, null, 2); assert.ok(new TextEncoder().encode(outer).byteLength > PREPARATION_PACKET_BYTES);
  assert.equal(preparationPacketJson(packet, context), null); assert.equal(reopenPreparationPacketJson(outer, context), null);
  assert.deepEqual(packet.preparations, before); assert.deepEqual(parts, before);
});
