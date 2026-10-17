import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
const harness = context => responsibilityDraftHarness(context, undefined, { url: new URL("../src/preparation-packet-view.tsx", import.meta.url), name: "PreparationPacketView" });
const button = (h, text) => h.nodes().find(node => node.type === "button" && node.props.children === text) ?? assert.fail(text);
const part = (h, name) => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith(`-part-${name}`)) ?? assert.fail(name);
const body = h => renderToStaticMarkup(h.render());
const readingBody = h => {
  const html = body(h), start = html.indexOf("<summary>Read prepared dossier together</summary>");
  assert.ok(start >= 0, "The checked packet needs its own private reading panel");
  return html.slice(start, html.indexOf("</details>", start));
};
test("an exact private packet exposes its actual six prepared values together after explicit inspection", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  for (const [name, value] of Object.entries(parts)) part(h, name).props.onChange({ currentTarget: { value } });
  button(h, "Inspect combined preparation packet").props.onClick();
  assert.ok(h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value, "Existing exact packet is valid");
  const html = readingBody(h); assert.match(html, /Private preparation reading/);
  assert.match(html, /Invented local population/); assert.match(html, /Invented authority/);
  assert.match(html, /-0\.000/); assert.match(html, /Withheld/); h.unmount();
});
test("private reading is absent before inspection and newer typed input withdraws it before a deferred merge", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); assert.doesNotMatch(body(h), /<h4>Private preparation reading/);
  for (const [name, value] of Object.entries(parts)) part(h, name).props.onChange({ currentTarget: { value } });
  assert.doesNotMatch(body(h), /<h4>Private preparation reading/); button(h, "Inspect combined preparation packet").props.onClick();
  assert.match(readingBody(h), /Invented local population/); const old = button(h, "Inspect combined preparation packet").props.onClick;
  h.pauseMerges(); part(h, "scope").props.onChange({ currentTarget: { value: parts.scope + "\n" } });
  assert.doesNotMatch(body(h), /<h4>Private preparation reading/); old(); h.flushMerges(); button(h, "Inspect combined preparation packet").props.onClick();
  assert.doesNotMatch(body(h), /<h4>Private preparation reading/); assert.match(body(h), /Preparation packet corrections/); h.unmount();
});
test("one invalid copied part withholds the joined reading without erasing other typed material", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  for (const [name, value] of Object.entries(parts)) part(h, name).props.onChange({ currentTarget: { value } });
  button(h, "Inspect combined preparation packet").props.onClick(); readingBody(h);
  part(h, "funding").props.onChange({ currentTarget: { value: parts.indicators } }); button(h, "Inspect combined preparation packet").props.onClick();
  assert.doesNotMatch(body(h), /<h4>Private preparation reading/); assert.equal(part(h, "funding").props["aria-invalid"], true);
  assert.equal(part(h, "scope").props.value, parts.scope); h.unmount();
});
test("Clear context replacement and unmount deny old inspectors and private reading data", () => {
  for (const action of ["clear", "context", "unmount"]) {
    const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); part(h, "scope").props.onChange({ currentTarget: { value: parts.scope } });
    button(h, "Inspect combined preparation packet").props.onClick(); readingBody(h); const old = button(h, "Inspect combined preparation packet").props.onClick;
    if (action === "clear") button(h, "Clear preparation packet").props.onClick();
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = "87000000-0000-4000-8000-000000000994"; h.render(next); }
    if (action === "unmount") h.unmount(); old(); assert.doesNotMatch(body(h), /<h4>Private preparation reading/); h.unmount();
  }
});
test("reopening a partial saved packet removes stale reading values and retains absent-slot meaning", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  for (const [name, value] of Object.entries(parts)) part(h, name).props.onChange({ currentTarget: { value } });
  button(h, "Inspect combined preparation packet").props.onClick(); assert.match(readingBody(h), /Invented local population/);
  const partial = Object.fromEntries(Object.keys(parts).map(name => [name, name === "delivery" ? parts.delivery : null]));
  const json = preparationPacketJson(preparationPacketFromParts(partial, c), c);
  h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-packet-paste")).props.onChange({ currentTarget: { value: json } });
  assert.doesNotMatch(body(h), /<h4>Private preparation reading/); button(h, "Reopen preparation packet").props.onClick();
  assert.match(readingBody(h), /No copy supplied/); assert.match(readingBody(h), /Pilot/); assert.doesNotMatch(readingBody(h), /Invented local population|Invented authority/);
  assert.equal(part(h, "scope").props.value, ""); h.unmount();
});
test("explicit native File replacement projects only the newly installed private values and no filename", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  part(h, "scope").props.onChange({ currentTarget: { value: parts.scope } }); button(h, "Inspect combined preparation packet").props.onClick(); readingBody(h);
  const scope = JSON.parse(parts.scope); scope.fields.population.wording = "A different invented population"; parts.scope = JSON.stringify(scope, null, 2);
  const json = preparationPacketJson(preparationPacketFromParts(parts, c), c), file = new File([json], "PRIVATE_READING_FILENAME.json");
  const picker = h.nodes().find(node => node.type === "input" && node.props.type === "file");
  picker.props.onChange({ currentTarget: { files: [file], value: "PRIVATE_PATH" } }); assert.doesNotMatch(body(h), /<h4>Private preparation reading/);
  await new Promise(resolve => setImmediate(resolve)); assert.match(readingBody(h), /A different invented population/);
  assert.doesNotMatch(readingBody(h), /Invented local population|PRIVATE_READING_FILENAME|PRIVATE_PATH/); assert.equal(part(h, "scope").props.value, parts.scope); h.unmount();
});
