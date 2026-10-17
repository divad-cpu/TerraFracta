import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts, packetReport } from "./helpers/preparation_packet_fixture.mjs";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
import { proposalId, proposalScope } from "./helpers/proposal_fixture.mjs";
import { loadTsx } from "./helpers/tsx_loader.mjs";
const harness = c => responsibilityDraftHarness(c, undefined, { url: new URL("../src/preparation-packet-view.tsx", import.meta.url), name: "PreparationPacketView" });
const button = (h, text) => h.nodes().find(node => node.type === "button" && node.props.children === text) ?? assert.fail(text);
const click = (h, text) => button(h, text).props.onClick();
const part = (h, name) => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith(`-part-${name}`));
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const paste = h => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-packet-paste"));
const input = (h, name, value) => part(h, name).props.onChange({ currentTarget: { value } });
const noNetwork = t => t.mock.method(globalThis, "fetch", () => assert.fail("No network is permitted"));

test("packet controls and local picker start disabled with native labels and no form or remote transport", t => {
  noNetwork(t); const h = harness(packetContext());
  assert.ok(h.nodes().filter(node => ["button", "textarea", "input"].includes(node.type)).every(node => node.props.disabled));
  const html = renderToStaticMarkup(h.render()); assert.doesNotMatch(html, /<form|type="submit"|download=|href="https:/);
  assert.equal(h.nodes().filter(node => node.type === "input" && node.props.type === "file").length, 2);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
  for (const id of ids) assert.ok(html.includes(`for="${id}"`)); h.unmount();
});
test("all six exact preparations roundtrip together and the joined overview counts editing material only", t => {
  noNetwork(t); const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  for (const [name, value] of Object.entries(parts)) input(h, name, value);
  click(h, "Inspect combined preparation packet"); assert.deepEqual(JSON.parse(output(h)).preparations, parts);
  const json = output(h), html = renderToStaticMarkup(h.render());
  for (const text of ["Supplied editing material", "12 unknown fields", "not readiness or quality scores", "An explicit download can request a private local JSON file"]) assert.ok(html.includes(text), text);
  click(h, "Clear preparation packet"); assert.equal(output(h), undefined);
  paste(h).props.onChange({ currentTarget: { value: json } }); click(h, "Reopen preparation packet"); assert.equal(output(h), json);
  for (const [name, value] of Object.entries(parts)) assert.equal(part(h, name).props.value, value); h.unmount();
});
test("absent empty and all-unknown editing material remain distinct in the visible overview", t => {
  noNetwork(t); const c = packetContext(), parts = packetParts(c), empty = JSON.parse(parts.delivery); empty.entries = [];
  const scope = JSON.parse(parts.scope); scope.fields.population = null;
  const h = harness(c); h.mount(); input(h, "scope", JSON.stringify(scope, null, 2)); input(h, "delivery", JSON.stringify(empty, null, 2));
  click(h, "Inspect combined preparation packet"); const html = renderToStaticMarkup(h.render());
  assert.match(html, /Not supplied/); assert.match(html, /Supplied empty entry list/); assert.match(html, /0 supplied fields; 3 unknown fields/);
  assert.equal(JSON.parse(output(h)).preparations.funding, null); h.unmount();
});
test("mixed captured bindings and malformed individual formats hold the combined preview while preserving typed drafts", t => {
  noNetwork(t); const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); input(h, "scope", parts.scope);
  click(h, "Inspect combined preparation packet"); assert.ok(output(h));
  const bad = JSON.parse(parts.funding); bad.binding.captureId = proposalId(299); const text = JSON.stringify(bad, null, 2);
  input(h, "funding", text); click(h, "Inspect combined preparation packet"); assert.equal(output(h), undefined); assert.equal(part(h, "funding").props.value, text);
  assert.match(renderToStaticMarkup(h.render()), /Preparation packet held/);
  input(h, "funding", parts.indicators); click(h, "Inspect combined preparation packet"); assert.equal(output(h), undefined); assert.equal(part(h, "scope").props.value, parts.scope); h.unmount();
});
test("newer part and packet input eagerly withhold an old preview before deferred state merges", t => {
  noNetwork(t); const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); input(h, "scope", parts.scope); click(h, "Inspect combined preparation packet");
  const old = button(h, "Inspect combined preparation packet").props.onClick;
  h.pauseMerges(); input(h, "scope", parts.scope + "\n"); assert.equal(output(h), undefined); old(); h.flushMerges();
  assert.equal(output(h), undefined); click(h, "Inspect combined preparation packet"); assert.equal(output(h), undefined); h.unmount();
});
test("same-control reentry wins and retired target getters cannot expose a later private value", t => {
  noNetwork(t); const c = packetContext(), h = harness(c); h.mount(); const change = part(h, "scope").props.onChange; let observed = 0;
  change({ get currentTarget() { change({ currentTarget: { value: "NEWER" } }); return { get value() { observed++; return "PRIVATE_OLDER"; } }; } });
  assert.equal(observed, 0); assert.equal(part(h, "scope").props.value, "NEWER");
  change({ get currentTarget() { click(h, "Clear preparation packet"); return { get value() { observed++; return "PRIVATE_CLEARED"; } }; } });
  assert.equal(observed, 0); assert.equal(part(h, "scope").props.value, ""); h.unmount();
});
test("independent part edits merge in one batch and reentrant other-part events do not discard the first preparation", t => {
  noNetwork(t); const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); h.pauseMerges();
  part(h, "scope").props.onChange({ get currentTarget() { input(h, "funding", parts.funding); return { value: parts.scope }; } });
  input(h, "delivery", parts.delivery); h.flushMerges();
  for (const name of ["scope", "funding", "delivery"]) assert.equal(part(h, name).props.value, parts[name]);
  click(h, "Inspect combined preparation packet"); const out = JSON.parse(output(h)); assert.equal(out.preparations.responsibility, null); h.unmount();
});
test("clear context replacement and unmount retire old input and action closures before any event observation", t => {
  noNetwork(t);
  for (const action of ["clear", "context", "unmount"]) {
    const c = packetContext(), h = harness(c); h.mount(); const change = part(h, "scope").props.onChange;
    const inspect = button(h, "Inspect combined preparation packet").props.onClick, reopen = button(h, "Reopen preparation packet").props.onClick;
    if (action === "clear") click(h, "Clear preparation packet");
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = proposalId(298); h.render(next); }
    if (action === "unmount") h.unmount();
    change(new Proxy({}, { get() { assert.fail("Retired input observed event"); } })); inspect(); reopen(); assert.equal(output(h), undefined); h.unmount();
  }
});
test("caught input faults expose only the fixed hold and later explicit input can recover", t => {
  noNetwork(t); const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  part(h, "scope").props.onChange({ get currentTarget() { throw Error("PRIVATE_EVENT_EXCEPTION"); } });
  const html = renderToStaticMarkup(h.render()); assert.match(html, /Preparation packet held/); assert.doesNotMatch(html, /PRIVATE_EVENT_EXCEPTION/);
  input(h, "scope", parts.scope); click(h, "Inspect combined preparation packet"); assert.ok(output(h)); h.unmount();
});
test("copied packet escape aliases are held and source-derived text cannot execute markup", t => {
  noNetwork(t); const c = packetContext(), parts = packetParts(c), scope = JSON.parse(parts.scope);
  scope.fields.population.wording = '<img src=x onerror="PRIVATE">'; parts.scope = JSON.stringify(scope, null, 2);
  const packet = preparationPacketFromParts(parts, c), json = preparationPacketJson(packet, c), h = harness(c); h.mount();
  paste(h).props.onChange({ currentTarget: { value: json } }); click(h, "Reopen preparation packet");
  assert.equal(output(h), json); assert.doesNotMatch(renderToStaticMarkup(h.render()), /<img/);
  const old = button(h, "Reopen preparation packet").props.onClick;
  paste(h).props.onChange({ currentTarget: { value: json + "\n" } }); old(); assert.equal(output(h), undefined); click(h, "Reopen preparation packet"); assert.equal(output(h), undefined); h.unmount();
});

test("valid individual copies that exceed the encoded outer budget stay editable while the combined preview is withheld", t => {
  noNetwork(t); const c = packetContext(), parts = largePacketParts(c), h = harness(c); h.mount();
  for (const [name, value] of Object.entries(parts)) input(h, name, value);
  click(h, "Inspect combined preparation packet"); assert.equal(output(h), undefined); assert.match(renderToStaticMarkup(h.render()), /Preparation packet held/);
  for (const [name, value] of Object.entries(parts)) assert.equal(part(h, name).props.value, value); h.unmount();
});

test("packet links reach all six exact worksheets only after the complete captured-comparison gate", () => {
  const { ProposalComparisonView } = loadTsx(new URL("../src/operator-proposal-view.tsx", import.meta.url)), report = packetReport();
  const html = renderToStaticMarkup(ProposalComparisonView({ decision: { kind: "ok", report }, selection: proposalScope() }));
  assert.match(html, /id="proposal-preparation-packet" tabindex="-1"/);
  for (const name of ["scope", "responsibility", "policy-event", "funding", "indicator", "delivery"]) {
    assert.ok(html.includes(`href="#proposal-${name}-preparation"`)); assert.ok(html.includes(`id="proposal-${name}-preparation"`));
  }
  for (const kind of ["unavailable", "invalid_scope", "capture_missing"]) {
    const held = renderToStaticMarkup(ProposalComparisonView({ decision: { kind, report }, selection: proposalScope() }));
    assert.doesNotMatch(held, /proposal-preparation-packet|Private preparation packet/);
  }
});
