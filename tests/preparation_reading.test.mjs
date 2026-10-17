import assert from "node:assert/strict";
import test from "node:test";
import { preparationPacketReading } from "../src/preparation-reading.ts";
import { preparationPacketFromParts } from "../src/preparation-packet.ts";
import { packetContext, packetParts, packetReport } from "./helpers/preparation_packet_fixture.mjs";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
const sample = () => { const c = packetContext(), parts = packetParts(c); return { c, parts, packet: preparationPacketFromParts(parts, c) }; };
const section = (reading, name) => reading.sections.find(section => section.part === name) ?? assert.fail(name);
const field = (reading, part, name, row = 0) => section(reading, part).entries[row].fields.find(field => field.key === name) ?? assert.fail(name);
const copy = value => JSON.stringify(value, null, 2);
test("private reading joins six original preparations as separate dimensions with exact field values", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No source lookup permitted"));
  const { c, packet } = sample(), before = structuredClone(packet), reading = preparationPacketReading(packet, c);
  assert.deepEqual(reading.sections.map(section => section.part), ["scope", "indicators", "responsibility", "policyEvents", "funding", "delivery"]);
  assert.equal(field(reading, "scope", "population").value, "Invented local population"); assert.equal(field(reading, "responsibility", "institution").value, "Invented authority");
  assert.equal(field(reading, "policyEvents", "kind").value, "Announcement"); assert.equal(field(reading, "funding", "amount").value, "-0.000");
  assert.equal(field(reading, "indicators", "missingReason").value, "Withheld"); assert.equal(field(reading, "delivery", "stage").value, "Pilot");
  assert.equal(section(reading, "scope").entries[0].statement, null); assert.equal(section(reading, "policyEvents").entries[0].statement.number, 2);
  assert.equal(section(reading, "responsibility").entries[0].statement.number, 2); assert.deepEqual(packet, before);
});
test("invalid mixed bindings malformed parts and over-budget exact packets expose no partial reading", () => {
  const { c, parts, packet } = sample();
  const invalid = structuredClone(packet); invalid.preparations.funding = parts.indicators;
  const foreign = structuredClone(packet); foreign.binding.captureId = "87000000-0000-4000-8000-000000000995";
  for (const value of [null, {}, invalid, foreign, { ...packet, PRIVATE: "PRIVATE" }, preparationPacketFromParts(largePacketParts(c), c)]) assert.equal(preparationPacketReading(value, c), null);
  assert.equal(preparationPacketReading(packet, { ...c, PRIVATE: "PRIVATE" }), null);
});
test("absent copy empty entries and supplied blank fields retain three different reading states", () => {
  const { c, parts } = sample(), scope = JSON.parse(parts.scope), delivery = JSON.parse(parts.delivery);
  for (const name of Object.keys(scope.fields)) scope.fields[name] = null; delivery.entries = [];
  const partial = Object.fromEntries(Object.keys(parts).map(name => [name, null])); partial.scope = copy(scope); partial.delivery = copy(delivery);
  const reading = preparationPacketReading(preparationPacketFromParts(partial, c), c);
  assert.equal(section(reading, "responsibility").status, "not_supplied"); assert.deepEqual(section(reading, "responsibility").entries, []);
  assert.equal(section(reading, "delivery").status, "empty"); assert.deepEqual(section(reading, "delivery").entries, []);
  assert.equal(section(reading, "scope").status, "supplied"); assert.ok(section(reading, "scope").entries[0].fields.every(field => field.value === null && field.references.length === 0));
  assert.deepEqual(reading.references, []);
});
test("decimal spellings beyond floating-point safety and unknown funding basis remain separate without arithmetic", () => {
  const { c, parts } = sample(), funding = JSON.parse(parts.funding), original = funding.entries[0];
  funding.entries = ["9007199254740993.000000001", "-0.000", "0", "0.000"].map(value => ({ ...structuredClone(original), fields: {
    ...structuredClone(original.fields), amount: { ...structuredClone(original.fields.amount), value },
  } })); parts.funding = copy(funding);
  const reading = preparationPacketReading(preparationPacketFromParts(parts, c), c);
  assert.deepEqual(section(reading, "funding").entries.map((_, index) => field(reading, "funding", "amount", index).value), ["9007199254740993.000000001", "-0.000", "0", "0.000"]);
  for (let i = 0; i < 4; i++) for (const name of ["currency", "scale", "priceBasis", "financialPeriod"]) assert.equal(field(reading, "funding", name, i).value, null);
});
test("prepared event dates retain exact day month year or stated period and reported time stays independent", () => {
  const { c, parts } = sample(), events = JSON.parse(parts.policyEvents), references = events.entries[0].fields.kind.references;
  const cases = [[{ precision: "day", value: "2024-02-29" }, "2024-02-29 (exact day)"], [{ precision: "month", value: "2030-02" }, "2030-02 (month only)"],
    [{ precision: "year", value: "2030" }, "2030 (year only)"], [{ precision: "period", label: "source interval 2030/31" }, "source interval 2030/31 (stated period)"]];
  events.entries = cases.map(([date]) => ({ ...structuredClone(events.entries[0]), fields: { ...structuredClone(events.entries[0].fields), eventDate: { date, references } } }));
  parts.policyEvents = copy(events); const reading = preparationPacketReading(preparationPacketFromParts(parts, c), c);
  assert.deepEqual(section(reading, "policyEvents").entries.map((_, i) => field(reading, "policyEvents", "eventDate", i).value), cases.map(([, text]) => text));
  for (let i = 0; i < 4; i++) assert.equal(field(reading, "policyEvents", "reportedDate", i).value, null);
});
test("reference indexing shares only exact occurrences and retains field order and captured original relation", () => {
  const { c, parts } = sample(), scope = JSON.parse(parts.scope), claimId = c.claims[0].id;
  scope.fields.population.references = [{ claimId, referenceNumber: 2 }, { claimId, referenceNumber: 1 }]; parts.scope = copy(scope);
  const reading = preparationPacketReading(preparationPacketFromParts(parts, c), c);
  assert.deepEqual(field(reading, "scope", "population").references, [`${claimId}:2`, `${claimId}:1`]);
  assert.deepEqual(reading.references.map(reference => [reference.statementNumber, reference.referenceNumber]), [[1, 1], [1, 2], [2, 1], [3, 1], [4, 1]]);
  const conflict = reading.references.find(reference => reference.key === `${claimId}:2`);
  assert.equal(conflict.originalRelation, "Points to a conflict"); assert.equal(conflict.originalHref, `#proposal-proposed-reference-${claimId}-2`);
  // Several proposed statements reuse one source version in this fixture. They
  // still retain distinct exact occurrences; the model infers no independence.
  const proposal = JSON.parse(packetReport().capture.proposalJson);
  assert.equal(proposal.snapshot.claims[0].evidence[0].sourceVersionId, proposal.snapshot.claims[1].evidence[0].sourceVersionId);
  assert.equal(reading.references.filter(reference => reference.referenceNumber === 1).length, 4);
});
test("source-stated missing reason and unknown exact observation are not silently replaced by zero", () => {
  const { c, packet } = sample(), reading = preparationPacketReading(packet, c);
  assert.equal(field(reading, "indicators", "value").value, null); assert.equal(field(reading, "indicators", "missingReason").value, "Withheld");
  assert.equal(field(reading, "indicators", "unit").value, null); assert.equal(field(reading, "indicators", "observationPeriod").value, null);
  assert.equal(field(reading, "delivery", "coverage").value, null); assert.equal(field(reading, "delivery", "eventDate").value, null);
});
test("each selected occurrence retains backlinks to its exact prepared fields without claiming source independence", () => {
  const { c, packet } = sample(), reading = preparationPacketReading(packet, c), condition = `${c.claims[0].id}:1`, policy = `${c.claims[1].id}:1`;
  assert.deepEqual(reading.references.find(reference => reference.key === condition).selections.map(selection => [selection.part, selection.entryNumber, selection.field]),
    [["scope", 1, "population"], ["indicators", 1, "missingReason"]]);
  assert.deepEqual(reading.references.find(reference => reference.key === policy).selections.map(selection => [selection.part, selection.entryNumber, selection.field]),
    [["responsibility", 1, "institution"], ["policyEvents", 1, "kind"]]);
  for (const reference of reading.references) for (const selection of reference.selections) {
    const entry = section(reading, selection.part).entries[selection.entryNumber - 1];
    assert.ok(entry.fields.find(field => field.key === selection.field).references.includes(reference.key));
  }
});
test("maximum synthetic captured choice context exposes only selected occurrences without truncating fields", () => {
  const c = packetContext(), original = structuredClone(c.claims);
  c.claims = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(original[index % original.length]),
    id: `87000000-0000-4000-8000-${String(700 + index).padStart(12, "0")}`,
    evidence: Array.from({ length: 12 }, (_, ref) => ({ ...structuredClone(original[0].evidence[ref % 2]), locator: `Invented native maximum row ${ref + 1}` })),
  }));
  // This is a maximum client-context shape, not a real capture/source attempt.
  const reading = preparationPacketReading(preparationPacketFromParts(packetParts(c), c), c);
  assert.ok(reading); assert.equal(c.claims.flatMap(claim => claim.evidence).length, 360);
  assert.equal(reading.references.length, 4); assert.equal(reading.sections.length, 6);
  assert.equal(reading.sections.reduce((count, section) => count + section.entries.reduce((sum, entry) => sum + entry.fields.length, 0), 0), 38);
});
test("checked context is detached before untrusted packet getters and unexpected faults expose no reading", () => {
  const { c, packet } = sample(), preparations = packet.preparations;
  Object.defineProperty(packet, "preparations", { get() { c.claims[0].evidence = []; return preparations; } });
  assert.ok(preparationPacketReading(packet, c)); assert.equal(preparationPacketReading(packet, c), null);
  const fresh = sample(); const bad = { ...fresh.packet, get preparations() { throw Error("PRIVATE_PACKET_FAULT"); } };
  assert.equal(preparationPacketReading(bad, fresh.c), null);
});
