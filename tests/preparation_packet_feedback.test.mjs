import assert from "node:assert/strict";
import test from "node:test";
import { preparationPacketFeedbackFromParts, preparationPacketFromParts, preparationPacketJson, PREPARATION_PACKET_BYTES } from "../src/preparation-packet.ts";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
const names = ["scope", "responsibility", "policyEvents", "funding", "indicators", "delivery"];
const absent = () => Object.fromEntries(names.map(name => [name, null]));
const clean = () => Object.fromEntries(names.map(name => [name, false]));
test("partial packets preserve absent slots and fixed hints never imply editorial source or publication approval", () => {
  const c = packetContext(), parts = { ...absent(), scope: packetParts(c).scope }, before = structuredClone(parts);
  assert.deepEqual(preparationPacketFeedbackFromParts(parts, c), { invalidParts: clean(), missing: false, oversized: false });
  assert.deepEqual(parts, before); assert.ok(preparationPacketFromParts(parts, c));
  assert.doesNotMatch(JSON.stringify(preparationPacketFeedbackFromParts(parts, c)), /claimId|captureId|approved|eligible|accepted|87000000/);
});
test("each malformed exact part is identified independently and no supplied copy is rewritten", () => {
  const c = packetContext(), originals = packetParts(c);
  for (const name of names) {
    const parts = { ...originals, [name]: originals[name] + "\n" }, before = structuredClone(parts);
    assert.deepEqual(preparationPacketFeedbackFromParts(parts, c), { invalidParts: { ...clean(), [name]: true }, missing: false, oversized: false });
    assert.equal(preparationPacketFromParts(parts, c), null); assert.deepEqual(parts, before);
  }
  const two = { ...originals, funding: originals.indicators, delivery: "PRIVATE_BAD_COPY" };
  assert.deepEqual(preparationPacketFeedbackFromParts(two, c).invalidParts, { ...clean(), funding: true, delivery: true });
});
test("foreign captured bindings remain held rather than rebound and affected fields alone get hints", () => {
  const c = packetContext(), parts = packetParts(c), foreign = JSON.parse(parts.funding);
  foreign.binding.captureId = "87000000-0000-4000-8000-000000000997"; parts.funding = JSON.stringify(foreign, null, 2);
  assert.deepEqual(preparationPacketFeedbackFromParts(parts, c).invalidParts, { ...clean(), funding: true });
  const newer = structuredClone(c); newer.binding.comparisonSha256 = "f".repeat(64);
  assert.ok(Object.values(preparationPacketFeedbackFromParts(parts, newer).invalidParts).every(Boolean));
});
test("no supplied parts differs from valid empty entries and valid all-unknown supplied scope", () => {
  const c = packetContext(), parts = packetParts(c);
  assert.deepEqual(preparationPacketFeedbackFromParts(absent(), c), { invalidParts: clean(), missing: true, oversized: false });
  const empty = JSON.parse(parts.delivery); empty.entries = [];
  assert.deepEqual(preparationPacketFeedbackFromParts({ ...absent(), delivery: JSON.stringify(empty, null, 2) }, c), { invalidParts: clean(), missing: false, oversized: false });
  const scope = JSON.parse(parts.scope); for (const key of Object.keys(scope.fields)) scope.fields[key] = null;
  assert.deepEqual(preparationPacketFeedbackFromParts({ ...absent(), scope: JSON.stringify(scope, null, 2) }, c), { invalidParts: clean(), missing: false, oversized: false });
});
test("individually valid copied parts can exceed escaped outer size without becoming invalid or changing bytes", () => {
  const c = packetContext(), parts = largePacketParts(c), before = structuredClone(parts), candidate = preparationPacketFromParts(parts, c);
  assert.ok(candidate); assert.ok(new TextEncoder().encode(JSON.stringify(candidate, null, 2)).byteLength > PREPARATION_PACKET_BYTES);
  assert.equal(preparationPacketJson(candidate, c), null);
  assert.deepEqual(preparationPacketFeedbackFromParts(parts, c), { invalidParts: clean(), missing: false, oversized: true }); assert.deepEqual(parts, before);
  const smaller = { ...parts, delivery: null }; assert.ok(preparationPacketJson(preparationPacketFromParts(smaller, c), c));
  assert.equal(preparationPacketFeedbackFromParts(smaller, c).oversized, false);
});
test("individual character and UTF8 limits stay separate from the complete outer-copy diagnosis", () => {
  const c = packetContext();
  for (const text of ["x".repeat(16_385), "😀".repeat(8000), "PRIVATE_NOT_JSON"]) {
    const parts = { ...absent(), scope: text };
    assert.deepEqual(preparationPacketFeedbackFromParts(parts, c), { invalidParts: { ...clean(), scope: true }, missing: false, oversized: false });
  }
});
test("malformed shape and private getters retain generic fallback without source text or exception output", () => {
  const c = packetContext(), parts = packetParts(c);
  for (const input of [null, [], { ...parts, PRIVATE: "PRIVATE" }, { scope: parts.scope }, { ...parts, funding: 1 },
    { ...parts, get funding() { throw Error("PRIVATE_FAULT"); } }]) assert.equal(preparationPacketFeedbackFromParts(input, c), null);
});
test("context is detached before one-time part observations and source iterators are never used", () => {
  const c = packetContext(), originals = packetParts(c), reads = new Map();
  const parts = Object.fromEntries(names.map(name => [name, null]));
  for (const name of names) Object.defineProperty(parts, name, { enumerable: true, get() { reads.set(name, (reads.get(name) ?? 0) + 1); if (name === "scope") c.claims[0].evidence = []; return originals[name]; } });
  Object.defineProperty(parts, Symbol.iterator, { get() { assert.fail("Parts iterator observed"); } });
  assert.deepEqual(preparationPacketFeedbackFromParts(parts, c), { invalidParts: clean(), missing: false, oversized: false });
  assert.ok(names.every(name => reads.get(name) === 1)); assert.equal(preparationPacketFeedbackFromParts(originals, c), null);
});
