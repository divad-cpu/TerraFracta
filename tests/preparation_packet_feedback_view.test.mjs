import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { largePacketParts } from "./helpers/preparation_packet_large_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
const harness = context => responsibilityDraftHarness(context, undefined, { url: new URL("../src/preparation-packet-view.tsx", import.meta.url), name: "PreparationPacketView" });
const button = (h, text) => h.nodes().find(node => node.type === "button" && node.props.children === text) ?? assert.fail(text);
const part = (h, name) => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith(`-part-${name}`)) ?? assert.fail(name);
const input = (h, name, value) => part(h, name).props.onChange({ currentTarget: { value } });
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const body = h => renderToStaticMarkup(h.render());
function links(h) {
  const html = body(h), ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]); assert.equal(ids.length, new Set(ids).size);
  for (const node of h.nodes().filter(node => node.props["aria-invalid"])) for (const id of node.props["aria-describedby"].split(" ")) assert.ok(ids.includes(id));
  const list = /<ul aria-label="Preparation packet corrections">[\s\S]*?<\/ul>/.exec(html)?.[0]; assert.ok(list);
  for (const [, id] of list.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id));
}
test("one invalid manual preparation identifies its own correction control and preserves other exact copies", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  input(h, "scope", parts.scope); input(h, "funding", parts.indicators); button(h, "Inspect combined preparation packet").props.onClick();
  assert.equal(output(h), undefined); assert.equal(part(h, "funding").props["aria-invalid"], true);
  assert.equal(part(h, "scope").props["aria-invalid"], undefined);
  assert.match(body(h), new RegExp(`href="#${part(h, "funding").props.id}"`));
  assert.equal(part(h, "scope").props.value, parts.scope); assert.equal(part(h, "funding").props.value, parts.indicators); h.unmount();
});
test("manual packet corrections link all and only malformed supplied parts without exposing diagnostic data", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); input(h, "scope", parts.scope);
  input(h, "funding", "PRIVATE_NOT_JSON"); input(h, "delivery", parts.indicators); button(h, "Inspect combined preparation packet").props.onClick(); links(h);
  for (const name of ["funding", "delivery"]) assert.equal(part(h, name).props["aria-invalid"], true);
  for (const name of ["scope", "responsibility", "policyEvents", "indicators"]) assert.equal(part(h, name).props["aria-invalid"], undefined);
  const list = /<ul aria-label="Preparation packet corrections">[\s\S]*?<\/ul>/.exec(body(h))[0]; assert.doesNotMatch(list, /PRIVATE|87000000/); h.unmount();
});
test("absent slots remain optional and explicit all-absent diagnosis requires no particular part", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); button(h, "Inspect combined preparation packet").props.onClick();
  assert.equal(output(h), undefined); assert.match(body(h), /No preparations supplied/); assert.match(body(h), /No particular worksheet is required/);
  assert.ok(h.nodes().filter(node => node.type === "textarea").every(node => node.props["aria-invalid"] === undefined));
  input(h, "delivery", parts.delivery); button(h, "Inspect combined preparation packet").props.onClick();
  assert.equal(JSON.parse(output(h)).preparations.scope, null); assert.doesNotMatch(body(h), /No preparations supplied|Preparation packet corrections/); h.unmount();
});
test("confirmed outer size is explained without blaming valid parts or changing any copied byte", () => {
  const c = packetContext(), parts = largePacketParts(c), h = harness(c); h.mount();
  for (const [name, value] of Object.entries(parts)) input(h, name, value); button(h, "Inspect combined preparation packet").props.onClick();
  assert.equal(output(h), undefined); assert.match(body(h), /combined JSON exceeds 128 KiB including escaping/);
  assert.doesNotMatch(body(h), /Preparation packet corrections/);
  for (const [name, value] of Object.entries(parts)) { assert.equal(part(h, name).props.value, value); assert.equal(part(h, name).props["aria-invalid"], undefined); }
  h.unmount();
});
test("part editing Clear context replacement and unmount withdraw earlier manual hints and inspectors", () => {
  for (const action of ["edit", "clear", "context", "unmount"]) {
    const c = packetContext(), h = harness(c); h.mount(); input(h, "scope", "BAD_COPY"); button(h, "Inspect combined preparation packet").props.onClick(); links(h);
    const old = button(h, "Inspect combined preparation packet").props.onClick;
    if (action === "edit") { h.pauseMerges(); input(h, "scope", "NEWER_COPY"); }
    if (action === "clear") button(h, "Clear preparation packet").props.onClick();
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = "87000000-0000-4000-8000-000000000996"; h.render(next); }
    if (action === "unmount") h.unmount(); old(); assert.doesNotMatch(body(h), /Preparation packet corrections/);
    assert.ok(h.nodes().filter(node => node.type === "textarea").every(node => node.props["aria-invalid"] === undefined));
    if (action === "edit") h.flushMerges(); h.unmount();
  }
});
test("saved packet paste failures stay generic and valid reopening retires manual part hints", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); input(h, "funding", "BAD_COPY"); button(h, "Inspect combined preparation packet").props.onClick(); links(h);
  const paste = () => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-packet-paste"));
  paste().props.onChange({ currentTarget: { value: "BAD_PACKET" } }); button(h, "Reopen preparation packet").props.onClick();
  assert.equal(output(h), undefined); assert.match(body(h), /Preparation packet held/); assert.doesNotMatch(body(h), /Preparation packet corrections/);
  const json = preparationPacketJson(preparationPacketFromParts(parts, c), c); paste().props.onChange({ currentTarget: { value: json } });
  button(h, "Reopen preparation packet").props.onClick(); assert.equal(output(h), json); assert.doesNotMatch(body(h), /Preparation packet corrections/); h.unmount();
});
test("a held native File does not diagnose its private parts or keep stale manual correction hints", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); input(h, "scope", parts.scope); input(h, "funding", "BAD_COPY");
  button(h, "Inspect combined preparation packet").props.onClick(); links(h);
  const picker = h.nodes().find(node => node.type === "input" && node.props.type === "file");
  picker.props.onChange({ currentTarget: { files: [new File(["PRIVATE_FILE_CONTENT"], "PRIVATE_NAME.json")], value: "PRIVATE_PATH" } });
  await new Promise(resolve => setImmediate(resolve)); assert.match(body(h), /Local packet file held/);
  assert.doesNotMatch(body(h), /PRIVATE_FILE_CONTENT|PRIVATE_NAME|PRIVATE_PATH|Preparation packet corrections/);
  assert.equal(part(h, "scope").props.value, parts.scope); assert.equal(part(h, "funding").props.value, "BAD_COPY"); h.unmount();
});
