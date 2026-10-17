import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { packetFileHarnessFactory } from "./helpers/packet_file_shared_harness.mjs";
import { responsibilityDraftHarness } from "./helpers/responsibility_draft_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
const harness = context => responsibilityDraftHarness(context, undefined, { url: new URL("../src/preparation-packet-view.tsx", import.meta.url), name: "PreparationPacketView" });
const button = (h, text) => h.nodes().find(n => n.type === "button" && n.props.children === text)?.props.onClick ?? assert.fail(text);
const textarea = (h, suffix) => h.nodes().find(n => n.type === "textarea" && n.props.id?.endsWith(suffix)).props;
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
const body = h => renderToStaticMarkup(h.render());

for (const action of ["Clear", "manual inspection", "saved reading"]) test(`old invalid Reopen cannot remove newer ${action} during original parsing`, t => {
  const c = packetContext(), parts = packetParts(c), h = harness(c); h.mount(); const invalid = "OLD_PRIVATE_INVALID";
  const json = preparationPacketJson(preparationPacketFromParts(parts, c), c);
  textarea(h, "-packet-paste").onChange({ currentTarget: { value: invalid } });
  const parse = JSON.parse; let retired = false;
  t.mock.method(JSON, "parse", (text, ...args) => {
    if (!retired && text === invalid) {
      retired = true;
      if (action === "Clear") button(h, "Clear preparation packet")();
      else if (action === "manual inspection") {
        textarea(h, "-part-scope").onChange({ currentTarget: { value: parts.scope } }); button(h, "Inspect combined preparation packet")();
        assert.equal(typeof output(h), "string");
      } else {
        textarea(h, "-packet-paste").onChange({ currentTarget: { value: json } }); button(h, "Read saved preparation packet")();
        assert.match(body(h), /<h3>Saved preparation reading/);
      }
    }
    return parse(text, ...args);
  });
  button(h, "Reopen preparation packet")(); assert.equal(retired, true); assert.doesNotMatch(body(h), /Preparation packet held\./);
  if (action === "Clear") { assert.equal(textarea(h, "-packet-paste").value, ""); assert.equal(output(h), undefined); }
  if (action === "manual inspection") { assert.equal(JSON.parse(output(h)).preparations.scope, parts.scope); assert.equal(textarea(h, "-part-scope").value, parts.scope); }
  if (action === "saved reading") { assert.match(body(h), /<h3>Saved preparation reading/); assert.equal(textarea(h, "-packet-paste").value, json); }
  h.unmount();
});

test("Clear retires its own saved-state cleanup before cancellation can establish a newer saved reading", async t => {
  const c = packetContext(), parts = packetParts(c), create = packetFileHarnessFactory(), h = create(c); h.mount();
  const json = preparationPacketJson(preparationPacketFromParts(parts, c), c), bytes = new TextEncoder().encode(json);
  let settle, controller; const pending = new Promise(resolve => { settle = resolve; });
  const Native = AbortController, capture = t.mock.method(globalThis, "AbortController", function () { const value = new Native(); controller ??= value; return value; });
  const picker = () => h.nodes().find(n => n.type === "input" && n.props.type === "file").props;
  picker().onChange({ currentTarget: { files: [{ size: bytes.byteLength, slice: () => ({ arrayBuffer: () => pending }) }], value: "" } }); capture.mock.restore();
  const abort = controller.abort; let reentered = false;
  Object.defineProperty(controller, "abort", { value(...args) {
    if (!reentered) {
      reentered = true; textarea(h, "-packet-paste").onChange({ currentTarget: { value: json } }); button(h, "Read saved preparation packet")();
      assert.match(body(h), /<h3>Saved preparation reading/);
    }
    return Reflect.apply(abort, controller, args);
  } });
  try {
    button(h, "Clear preparation packet")(); assert.equal(reentered, true); assert.equal(picker().disabled, true);
    assert.equal(textarea(h, "-packet-paste").value, json); assert.match(body(h), /<h3>Saved preparation reading/); assert.equal(output(h), undefined);
  } finally { settle(bytes.buffer); await new Promise(resolve => setImmediate(resolve)); assert.equal(picker().disabled, false); h.unmount(); }
});
