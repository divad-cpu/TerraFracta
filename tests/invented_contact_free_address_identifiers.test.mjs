import assert from "node:assert/strict";
import test from "node:test";
import { createInventedContactFreeAddressIdentifiers as create } from "../src/invented-contact-free-address-identifiers.ts";
import { createInventedContactFreeAdmission } from "../src/invented-contact-free-admission.ts";
const window = 900_000, epoch = 100, initial = epoch * window;
const material = value => Array(32).fill(value); // Deliberately public invented fixtures, never real keys.
const fixture = () => ({ kind: "invented_public_key_material", epoch, current: material(2), previous: material(1) });
const address = value => ({ kind: "invented_transport_address", address: value });
const fresh = clock => create(fixture(), clock);
const rotate = (issuer, nextEpoch, value) => issuer.owner.rotate({ kind: "invented_public_key_rotation", epoch: nextEpoch, current: material(value) });

test("native keyed pseudonyms are stable only within their scoped fixture epoch and expose no address/material", () => {
  const issuer = fresh(() => initial), first = issuer.transport.identify(address("192.0.2.1"));
  assert.equal(first.kind, "invented_identifiers");
  assert.deepEqual(first, issuer.transport.identify(address("192.0.2.1")));
  assert.notEqual(first.currentKey, first.previousKey);
  assert.notEqual(first.currentKey, issuer.transport.identify(address("192.0.2.2")).currentKey);
  assert.match(first.currentKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.currentExpiresAtMs, initial + 2 * window);
  assert.equal(first.previousExpiresAtMs, initial + window);
  assert.deepEqual(issuer.inspection.counts(), { kind: "counts", epoch, residentMaterials: 2 });
  assert.doesNotMatch(JSON.stringify([first, issuer.inspection.counts()]), /192\.0\.2|current":\[|previous":\[/);
  assert.equal(issuer.transport.rotate, undefined); assert.equal(issuer.owner.identify, undefined);
});

test("native IPv6 canonicalization and IPv4-mapped forms cannot split a fixture's attempt identity", () => {
  const issuer = fresh(() => initial);
  const v6 = ["2001:db8::1", "2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8:0:0::1"];
  for (const value of v6) assert.deepEqual(issuer.transport.identify(address(value)), issuer.transport.identify(address(v6[0])));
  for (const value of ["::ffff:192.0.2.1", "::FFFF:C000:0201", "0:0:0:0:0:ffff:c000:201"])
    assert.deepEqual(issuer.transport.identify(address(value)), issuer.transport.identify(address("192.0.2.1")));
});

test("only documentation-range addresses from the closed invented transport shape are accepted", () => {
  const issuer = fresh(() => initial);
  for (const input of [null, {}, "192.0.2.1", { ...address("192.0.2.1"), forwarded: "PRIVATE_CANARY" },
    ...["127.0.0.1", "192.168.0.1", "8.8.8.8", "2001:db9::1", "fe80::1%eth0", "[2001:db8::1]",
      "http://192.0.2.1", "192.0.2.1:80", "192.000.2.1", " 192.0.2.1", "192.0.2.1\n", "PRIVATE_CANARY"].map(address)]) {
    assert.deepEqual(issuer.transport.identify(input), { kind: "held" });
  }
  for (const value of ["192.0.2.1", "198.51.100.1", "203.0.113.1", "2001:db8::abcd"])
    assert.equal(issuer.transport.identify(address(value)).kind, "invented_identifiers");
});

test("constructor detaches public fixture arrays and rejects reused, malformed or extra material", () => {
  const input = fixture(), issuer = create(input, () => initial), before = issuer.transport.identify(address("192.0.2.1"));
  input.current.fill(99); input.previous.fill(99);
  assert.deepEqual(issuer.transport.identify(address("192.0.2.1")), before);
  for (const input of [{ ...fixture(), current: material(1) }, { ...fixture(), current: [] },
    { ...fixture(), current: Array(32).fill(256) }, { ...fixture(), secret: "PRIVATE_CANARY" },
    { ...fixture(), epoch: -1 }, { ...fixture(), current: Buffer.alloc(32, 2) }])
    assert.deepEqual(create(input, () => initial), { kind: "held" });
});

test("rotation requires the next observed epoch and preserves previous-window overlap", () => {
  let now = initial;
  const issuer = fresh(() => now), first = issuer.transport.identify(address("192.0.2.1"));
  assert.deepEqual(rotate(issuer, epoch + 1, 3), { kind: "held" });
  now += window;
  assert.deepEqual(issuer.transport.identify(address("192.0.2.1")), { kind: "held" });
  assert.deepEqual(rotate(issuer, epoch + 2, 3), { kind: "held" });
  assert.deepEqual(rotate(issuer, epoch + 1, 2), { kind: "held" });
  assert.equal(rotate(issuer, epoch + 1, 3).kind, "rotated_invented");
  const next = issuer.transport.identify(address("192.0.2.1"));
  assert.equal(next.previousKey, first.currentKey); assert.notEqual(next.currentKey, first.currentKey);
  assert.equal(next.previousExpiresAtMs, first.currentExpiresAtMs);
  assert.equal(issuer.inspection.counts().residentMaterials, 2);
});

test("prior keyed attempts survive rotation in the existing admission model", () => {
  let now = initial + window - 1000;
  const issuer = fresh(() => now), budget = createInventedContactFreeAdmission(
    { kind: "fresh_invented_trial", openReports: 0, acceptedAtMs: [] }, () => now);
  const input = bodyBytes => {
    const { epoch, currentKey, previousKey } = issuer.transport.identify(address("::ffff:192.0.2.1"));
    return { epoch, currentKey, previousKey, bodyBytes };
  };
  for (let n = 0; n < 5; n++) assert.equal(budget.writer.begin(input(16 * 1024 + 1)).reason, "body_limit");
  now = initial + window; rotate(issuer, epoch + 1, 3);
  assert.equal(budget.writer.begin(input(1)).reason, "address_limit");
  now = initial + 2 * window - 1000;
  assert.equal(budget.writer.begin(input(1)).kind, "reserved");
});

test("skipped epochs hold instead of silently resetting material continuity", () => {
  let now = initial;
  const issuer = fresh(() => now); issuer.transport.identify(address("192.0.2.1"));
  now += 2 * window;
  assert.deepEqual(issuer.inspection.counts(), { kind: "held" });
  assert.deepEqual(rotate(issuer, epoch + 2, 3), { kind: "held" });
  now = initial;
  assert.deepEqual(issuer.transport.identify(address("192.0.2.1")), { kind: "held" });
});

test("clock rollback, throws and malformed clocks invalidate future use without exception data", () => {
  for (const fault of [initial - 1, NaN, "PRIVATE_CANARY", "throw"]) {
    let now = initial;
    const issuer = fresh(() => { if (now === "throw") throw Error("PRIVATE_CANARY"); return now; });
    issuer.transport.identify(address("192.0.2.1")); now = fault;
    assert.deepEqual(issuer.transport.identify(address("192.0.2.1")), { kind: "held" });
    now = initial;
    assert.deepEqual(issuer.transport.identify(address("192.0.2.1")), { kind: "held" });
  }
});

test("invalidation inside a clock callback cannot issue identifiers from a lost context", () => {
  let issuer;
  issuer = fresh(() => { issuer.owner.invalidateForTrial(); return initial; });
  assert.deepEqual(issuer.transport.identify(address("192.0.2.1")), { kind: "held" });
});

test("reentrant clock observations stay held without losing the outer valid observation", () => {
  let issuer, nested;
  issuer = fresh(() => { nested = issuer.transport.identify(address("192.0.2.2")); return initial; });
  assert.equal(issuer.transport.identify(address("192.0.2.1")).kind, "invented_identifiers");
  assert.deepEqual(nested, { kind: "held" });
});

test("a long rotation sequence has two resident materials and never repeats a client's current pseudonym", () => {
  let now = initial;
  const issuer = fresh(() => now), observed = new Set();
  for (let n = 0; n < 32; n++) {
    if (n) { now += window; assert.equal(rotate(issuer, epoch + n, n + 2).kind, "rotated_invented"); }
    const value = issuer.transport.identify(address("2001:db8::1"));
    assert.equal(value.kind, "invented_identifiers");
    assert.equal(observed.has(value.currentKey), false); observed.add(value.currentKey);
    assert.equal(issuer.inspection.counts().residentMaterials, 2);
    assert.equal(value.currentExpiresAtMs - now, 2 * window);
  }
});
