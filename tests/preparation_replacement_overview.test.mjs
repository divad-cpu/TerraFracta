import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
const harness = context => responsibilityDraftHarness(context, undefined, { url: new URL("../src/preparation-packet-view.tsx", import.meta.url), name: "PreparationPacketView" });
const button = (h, label) => h.nodes().find(node => node.type === "button" && node.props.children === label) ?? assert.fail(label);
const textarea = (h, suffix) => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith(suffix)) ?? assert.fail(suffix);
const write = (h, name, value) => textarea(h, `-part-${name}`).props.onChange({ currentTarget: { value } });
const paste = (h, value) => textarea(h, "-packet-paste").props.onChange({ currentTarget: { value } });
const body = h => renderToStaticMarkup(h.render());
const overview = h => /<table><caption>What Reopen would do to typed copies<\/caption>([\s\S]*?)<\/table>/.exec(body(h))?.[1] ?? "";
const rows = h => [...overview(h).matchAll(/<tr><th scope="row">([^<]+)<\/th><td>([^<]+)<\/td><\/tr>/g)].map(match => match.slice(1));

test("saved reading identifies exact six-slot replacement including loss of unfinished typed copies without changing them", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  const indicator = JSON.parse(parts.indicators); indicator.entries[0].fields.missingReason = null;
  const saved = { scope: parts.scope, responsibility: null, policyEvents: parts.policyEvents, funding: null, indicators: JSON.stringify(indicator, null, 2), delivery: null };
  const current = { scope: parts.scope, responsibility: "PRIVATE_UNFINISHED_COPY", policyEvents: "", funding: "", indicators: parts.indicators, delivery: " " };
  for (const [name, value] of Object.entries(current)) write(h, name, value);
  const json = preparationPacketJson(preparationPacketFromParts(saved, c), c); assert.equal(typeof json, "string");
  paste(h, json); button(h, "Read saved preparation packet").props.onClick();
  assert.deepEqual(rows(h).map(row => row[1]), ["Would keep exact copied text", "Would remove current typed copy", "Would supply saved copy", "Would keep absent", "Would replace with different copied text", "Would remove current typed copy"]);
  assert.doesNotMatch(overview(h), /PRIVATE_UNFINISHED_COPY|Invented local population|withheld/);
  for (const [name, value] of Object.entries(current)) assert.equal(textarea(h, `-part-${name}`).props.value, value);
  assert.match(body(h), /Exact copied text only/);
  button(h, "Reopen preparation packet").props.onClick();
  assert.equal(overview(h), ""); for (const [name, value] of Object.entries(saved)) assert.equal(textarea(h, `-part-${name}`).props.value, value ?? ""); h.unmount();
});

test("each of six exact slots distinguishes all five replacement states without parsing current text", () => {
  const c = packetContext(), parts = packetParts(c), names = Object.keys(parts);
  for (const name of names) for (const [kind, current, incoming, expected] of [
    ["absent", "", null, "Would keep absent"], ["supply", "", parts[name], "Would supply saved copy"],
    ["remove", "  ", null, "Would remove current typed copy"], ["same", parts[name], parts[name], "Would keep exact copied text"],
    ["different", "UNFINISHED_NOT_JSON", parts[name], "Would replace with different copied text"],
  ]) {
    const h = harness(c); h.mount(); write(h, name, current);
    const saved = Object.fromEntries(names.map(key => [key, key === name ? incoming : null]));
    if (incoming === null) { const other = names.find(key => key !== name); saved[other] = parts[other]; }
    const json = preparationPacketJson(preparationPacketFromParts(saved, c), c); assert.equal(typeof json, "string", `${name} ${kind}`);
    paste(h, json); button(h, "Read saved preparation packet").props.onClick();
    assert.equal(rows(h).length, 6); assert.equal(rows(h)[names.indexOf(name)][1], expected, `${name} ${kind}`);
    assert.equal(textarea(h, `-part-${name}`).props.value, current); assert.doesNotMatch(overview(h), /UNFINISHED_NOT_JSON/); h.unmount();
  }
});

test("a different JSON spelling remains a different exact copy without claiming changed fields or facts", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  const minified = JSON.stringify(JSON.parse(parts.scope)); assert.notEqual(minified, parts.scope);
  write(h, "scope", minified); const saved = Object.fromEntries(Object.keys(parts).map(name => [name, name === "scope" ? parts.scope : null]));
  const json = preparationPacketJson(preparationPacketFromParts(saved, c), c); paste(h, json); button(h, "Read saved preparation packet").props.onClick();
  assert.equal(rows(h)[0][1], "Would replace with different copied text"); assert.match(body(h), /not a comparison of fields, evidence or facts/);
  assert.equal(textarea(h, "-part-scope").props.value, minified); h.unmount();
});

test("only a successful current saved reading exposes a replacement table and later intent eagerly withdraws it", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  paste(h, "PRIVATE_INVALID"); button(h, "Read saved preparation packet").props.onClick(); assert.equal(overview(h), "");
  const saved = Object.fromEntries(Object.keys(parts).map(name => [name, name === "scope" ? parts.scope : null]));
  paste(h, preparationPacketJson(preparationPacketFromParts(saved, c), c)); button(h, "Read saved preparation packet").props.onClick();
  assert.equal(rows(h).length, 6); const old = button(h, "Read saved preparation packet").props.onClick;
  h.pauseMerges(); write(h, "responsibility", "NEW_UNFINISHED_COPY"); assert.equal(overview(h), ""); old(); h.flushMerges();
  assert.equal(overview(h), ""); assert.equal(textarea(h, "-part-responsibility").props.value, "NEW_UNFINISHED_COPY"); h.unmount();
});
