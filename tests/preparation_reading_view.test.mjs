import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { packetContext, packetParts, packetReport } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts } from "../src/preparation-packet.ts";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
import { proposalScope } from "./helpers/proposal_fixture.mjs";
const { PreparationReadingView } = loadTsx(new URL("../src/preparation-reading-view.tsx", import.meta.url));
const render = (packet, context, prefix = "prepared-test") => renderToStaticMarkup(PreparationReadingView({ packet, context, prefix }));
const sample = () => { const c = packetContext(), parts = packetParts(c); return { c, parts, packet: preparationPacketFromParts(parts, c) }; };
test("private joined reading displays actual prepared values and fixed limits without editable controls or external transport", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No source request permitted"));
  const { c, packet } = sample(), html = render(packet, c);
  for (const value of ["Invented local population", "Invented authority", "Announcement", "-0.000", "Withheld", "Pilot"]) assert.ok(html.includes(value), value);
  assert.match(html, /unreviewed preparation/); assert.match(html, /no factual support/); assert.match(html, /not matched across measures/);
  assert.match(html, /unknown observations are not zero/i); assert.match(html, /no total, conversion or expenditure/);
  assert.doesNotMatch(html, /<form|<input|<textarea|<button|href="https?:|download=/);
});
test("private reading reference targets are unique local fragments and original targets resolve in the actual captured comparison", () => {
  const { c, packet } = sample(), html = render(packet, c), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url));
  const parent = renderToStaticMarkup(ProposalComparisonView({ decision: { kind: "ok", report: packetReport() }, selection: proposalScope() }));
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
    if (target.startsWith("prepared-test-")) assert.ok(ids.includes(target), target);
    else assert.ok(parent.includes(`id="${target}"`), target);
  }
  assert.match(html, /Original relation to the proposed statement/); assert.match(html, /not independent confirmation/);
});
test("private reading keeps absent copies empty lists and blank fields distinct with no invented absence finding", () => {
  const { c, parts } = sample(), scope = JSON.parse(parts.scope), delivery = JSON.parse(parts.delivery);
  for (const name of Object.keys(scope.fields)) scope.fields[name] = null; delivery.entries = [];
  const partial = Object.fromEntries(Object.keys(parts).map(name => [name, null])); partial.scope = JSON.stringify(scope, null, 2); partial.delivery = JSON.stringify(delivery, null, 2);
  const html = render(preparationPacketFromParts(partial, c), c);
  for (const message of ["No copy supplied", "Supplied copy contains no entries", "Not supplied in this preparation", "No field-specific reference choices were supplied", "not proof of missing evidence or inaction"]) assert.ok(html.includes(message), message);
});
test("invalid foreign and oversized inputs yield only fixed unavailability and no partial private values", () => {
  const { c, packet } = sample(), invalid = structuredClone(packet); invalid.preparations.funding = "PRIVATE_FAULT";
  for (const input of [null, invalid, preparationPacketFromParts(largePacketParts(c), c)]) {
    const html = render(input, c); assert.match(html, /Private preparation reading unavailable/);
    assert.doesNotMatch(html, /PRIVATE_FAULT|Invented local population|Invented authority|Recorded reference choices/);
  }
});
test("source-derived markup remains literal text and separate instances use distinct fragment namespaces", () => {
  const { c, parts } = sample(), scope = JSON.parse(parts.scope); scope.fields.population.wording = '<img src=x onerror="PRIVATE">'; parts.scope = JSON.stringify(scope, null, 2);
  const packet = preparationPacketFromParts(parts, c), first = render(packet, c, "first-reading"), second = render(packet, c, "second-reading");
  assert.doesNotMatch(first, /<img|<script/); assert.match(first, /&lt;img/);
  const ids = [...(first + second).matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
});
