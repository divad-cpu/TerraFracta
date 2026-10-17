import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
const harness = context => responsibilityDraftHarness(context, undefined, { url: new URL("../src/preparation-packet-view.tsx", import.meta.url), name: "PreparationPacketView" });
const button = (h, text) => h.nodes().find(node => node.type === "button" && node.props.children === text) ?? assert.fail(text);
const part = (h, name) => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith(`-part-${name}`)) ?? assert.fail(name);
const paste = h => h.nodes().find(node => node.type === "textarea" && node.props.id?.endsWith("-packet-paste"));
const output = h => h.nodes().find(node => node.type === "textarea" && node.props.readOnly)?.props.value;
const body = h => renderToStaticMarkup(h.render());
const savedJson = (c, parts, keep = ["delivery"]) => preparationPacketJson(preparationPacketFromParts(
  Object.fromEntries(Object.keys(parts).map(name => [name, keep.includes(name) ? parts[name] : null])), c), c);

test("read a saved private packet before replacing typed parts, then reopen only by its separate explicit action", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount();
  part(h, "scope").props.onChange({ currentTarget: { value: parts.scope } });
  const json = savedJson(c, parts); paste(h).props.onChange({ currentTarget: { value: json } });
  button(h, "Read saved preparation packet").props.onClick();
  assert.match(body(h), /Saved preparation reading/); assert.match(body(h), /Private preparation reading/);
  assert.equal(part(h, "scope").props.value, parts.scope); assert.equal(part(h, "delivery").props.value, "");
  assert.equal(paste(h).props.value, json); assert.equal(output(h), undefined);
  button(h, "Reopen preparation packet").props.onClick();
  assert.equal(part(h, "scope").props.value, ""); assert.equal(part(h, "delivery").props.value, parts.delivery);
  assert.equal(output(h), json); assert.doesNotMatch(body(h), /<h3>Saved preparation reading/); h.unmount();
});

test("invalid foreign and oversized saved copies preserve all typed parts and expose only fixed held guidance", () => {
  const c = packetContext(), parts = packetParts(c), other = structuredClone(c); other.binding.captureId = "87000000-0000-4000-8000-000000000995";
  const foreign = packetParts(other);
  for (const value of ["PRIVATE_MALFORMED_PACKET", savedJson(other, foreign), " ".repeat(131_073)]) {
    const h = harness(c); h.mount();
    for (const [name, text] of Object.entries(parts)) part(h, name).props.onChange({ currentTarget: { value: text } });
    paste(h).props.onChange({ currentTarget: { value } }); button(h, "Read saved preparation packet").props.onClick();
    const status = h.nodes().filter(node => node.type === "p" && node.props.role === "status").map(node => node.props.children).join(" ");
    assert.match(status, /^Saved preparation reading held\./); assert.doesNotMatch(status, /PRIVATE_MALFORMED_PACKET|87000000/);
    for (const [name, text] of Object.entries(parts)) assert.equal(part(h, name).props.value, text);
    assert.equal(paste(h).props.value, value); assert.equal(output(h), undefined); assert.doesNotMatch(body(h), /<h4>Private preparation reading/); h.unmount();
  }
});

test("only the inspected saved copy is read and unknown empty and absent states retain separate meanings", () => {
  const c = packetContext(), parts = packetParts(c), scope = JSON.parse(parts.scope); scope.fields.population.wording = "Saved-only population";
  parts.scope = JSON.stringify(scope, null, 2); parts.delivery = JSON.stringify({ ...JSON.parse(parts.delivery), entries: [] }, null, 2);
  const h = harness(c); h.mount(); paste(h).props.onChange({ currentTarget: { value: savedJson(c, parts, ["scope", "funding", "delivery"]) } });
  button(h, "Read saved preparation packet").props.onClick();
  const html = body(h); assert.match(html, /Saved-only population/); assert.match(html, /-0\.000/);
  assert.match(html, /No copy supplied/); assert.match(html, /Supplied copy contains no entries/); assert.match(html, /Not supplied in this preparation/);
  for (const name of Object.keys(parts)) assert.equal(part(h, name).props.value, "");
  assert.equal(output(h), undefined); assert.equal(h.nodes().some(node => node.type === "button" && node.props.children === "Download private preparation packet"), false); h.unmount();
});

test("typing Clear context replacement and unmount retire the saved reader and every earlier callback", () => {
  for (const action of ["part", "paste", "clear", "context", "unmount", "inspect"]) {
    const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); paste(h).props.onChange({ currentTarget: { value: savedJson(c, parts) } });
    button(h, "Read saved preparation packet").props.onClick(); assert.match(body(h), /<h3>Saved preparation reading/);
    const old = button(h, "Read saved preparation packet").props.onClick;
    if (action === "part") part(h, "scope").props.onChange({ currentTarget: { value: parts.scope } });
    if (action === "paste") paste(h).props.onChange({ currentTarget: { value: "changed" } });
    if (action === "clear") button(h, "Clear preparation packet").props.onClick();
    if (action === "inspect") button(h, "Inspect combined preparation packet").props.onClick();
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = "87000000-0000-4000-8000-000000000996"; h.render(next); }
    if (action === "unmount") h.unmount();
    old(); assert.doesNotMatch(body(h), /<h3>Saved preparation reading/); h.unmount();
  }
});

test("saved reading retires before a deferred input merge and an old read cannot restore it", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); paste(h).props.onChange({ currentTarget: { value: savedJson(c, parts) } });
  button(h, "Read saved preparation packet").props.onClick(); const old = button(h, "Read saved preparation packet").props.onClick;
  h.pauseMerges(); part(h, "scope").props.onChange({ currentTarget: { value: parts.scope } });
  assert.doesNotMatch(body(h), /<h3>Saved preparation reading/); old(); assert.doesNotMatch(body(h), /<h3>Saved preparation reading/);
  h.flushMerges(); assert.doesNotMatch(body(h), /<h3>Saved preparation reading/); assert.equal(part(h, "scope").props.value, parts.scope); h.unmount();
});

test("fresh Clear during the original parser denies its later result without consuming newer text", t => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); const json = savedJson(c, parts);
  paste(h).props.onChange({ currentTarget: { value: json } }); const parse = JSON.parse; let retired = false;
  t.mock.method(JSON, "parse", (text, ...args) => {
    if (!retired && text === json) { retired = true; button(h, "Clear preparation packet").props.onClick(); }
    return parse(text, ...args);
  });
  button(h, "Read saved preparation packet").props.onClick(); assert.equal(retired, true);
  assert.equal(paste(h).props.value, ""); assert.doesNotMatch(body(h), /<h3>Saved preparation reading/); assert.equal(output(h), undefined); h.unmount();
});

test("saved reading cancels an earlier File result while its physical slot remains occupied until settlement", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const c = packetContext(), parts = packetParts(c), json = savedJson(c, parts); const h = harness(c); h.mount();
  paste(h).props.onChange({ currentTarget: { value: json } }); let resolveBytes, calls = 0;
  const bytes = new TextEncoder().encode(json), pending = new Promise(resolve => { resolveBytes = resolve; });
  const file = { size: bytes.byteLength, slice() { calls++; return { arrayBuffer: () => pending }; } };
  const picker = () => h.nodes().find(node => node.type === "input" && node.props.type === "file");
  picker().props.onChange({ currentTarget: { files: [file], value: "PRIVATE_PATH" } }); assert.equal(calls, 1);
  button(h, "Read saved preparation packet").props.onClick(); assert.match(body(h), /<h3>Saved preparation reading/);
  assert.equal(picker().props.disabled, true); assert.match(body(h), /still owns its physical slot/); assert.equal(output(h), undefined);
  resolveBytes(bytes.buffer); await new Promise(resolve => setImmediate(resolve));
  assert.equal(picker().props.disabled, false); assert.equal(output(h), undefined); assert.match(body(h), /<h3>Saved preparation reading/);
  assert.equal(part(h, "delivery").props.value, ""); assert.equal(paste(h).props.value, json); h.unmount();
});

test("a newer explicit File selection withdraws the saved reading before observing event properties", () => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); paste(h).props.onChange({ currentTarget: { value: savedJson(c, parts) } });
  button(h, "Read saved preparation packet").props.onClick(); assert.match(body(h), /<h3>Saved preparation reading/);
  const picker = h.nodes().find(node => node.type === "input" && node.props.type === "file"); let observed = false;
  picker.props.onChange({ get currentTarget() { observed = true; assert.doesNotMatch(body(h), /<h3>Saved preparation reading/); throw new Error("PRIVATE_PICKER_ERROR"); } });
  assert.equal(observed, true); assert.doesNotMatch(body(h), /<h3>Saved preparation reading|PRIVATE_PICKER_ERROR/); assert.equal(part(h, "delivery").props.value, ""); h.unmount();
});

test("cancellation reentry retires saved bytes before parsing and preserves newer Clear or pasted intent", async t => {
  for (const action of ["clear", "paste"]) {
    const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); const json = savedJson(c, parts);
    paste(h).props.onChange({ currentTarget: { value: json } }); let settle;
    const bytes = new TextEncoder().encode(json), pending = new Promise(resolve => { settle = resolve; });
    const picker = () => h.nodes().find(node => node.type === "input" && node.props.type === "file");
    picker().props.onChange({ currentTarget: { files: [{ size: bytes.byteLength, slice: () => ({ arrayBuffer: () => pending }) }], value: "" } });
    const abort = AbortController.prototype.abort, parse = JSON.parse; let retired = false, retiredParses = 0;
    const abortMock = t.mock.method(AbortController.prototype, "abort", function (...args) {
      if (!retired) {
        retired = true;
        if (action === "clear") button(h, "Clear preparation packet").props.onClick();
        else paste(h).props.onChange({ currentTarget: { value: "NEWER_PRIVATE_PASTE" } });
      }
      return Reflect.apply(abort, this, args);
    });
    const parseMock = t.mock.method(JSON, "parse", (text, ...args) => {
      if (retired && text === json) retiredParses++;
      return parse(text, ...args);
    });
    try {
      button(h, "Read saved preparation packet").props.onClick(); assert.equal(retired, true);
      assert.equal(picker().props.disabled, true); assert.doesNotMatch(body(h), /<h3>Saved preparation reading/);
      assert.equal(paste(h).props.value, action === "clear" ? "" : "NEWER_PRIVATE_PASTE");
    } finally {
      abortMock.mock.restore(); parseMock.mock.restore(); settle(bytes.buffer); await new Promise(resolve => setImmediate(resolve));
      assert.equal(picker().props.disabled, false); h.unmount();
    }
    assert.equal(retiredParses, 0, `${action} must stop a retired saved-copy parser`);
  }
});
