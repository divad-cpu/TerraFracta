import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { packetFileHarnessFactory } from "./helpers/packet_file_shared_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import * as packet from "../src/preparation-packet.ts";
const flush = () => new Promise(resolve => setImmediate(resolve));
const button = (h, text) => h.nodes().find(n => n.type === "button" && n.props.children === text)?.props.onClick ?? assert.fail(text);
const textarea = (h, suffix) => h.nodes().find(n => n.type === "textarea" && n.props.id?.endsWith(suffix)).props;
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;

// Inject only the component's existing exported final serializer. The native
// File decoder delegates to its unchanged real codec. This is not Browser use.
for (const action of ["Clear", "newer part", "saved reading"]) test(`a completed File cannot overwrite ${action} entered during its final export`, async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network permitted"));
  const c = packetContext(), parts = packetParts(c), json = packet.preparationPacketJson(packet.preparationPacketFromParts(parts, c), c);
  const partial = Object.fromEntries(Object.keys(parts).map(name => [name, name === "delivery" ? parts[name] : null]));
  const pasted = packet.preparationPacketJson(packet.preparationPacketFromParts(partial, c), c);
  let h, exports = 0;
  const create = packetFileHarnessFactory(name => name === "./preparation-packet.ts" ? { ...packet, preparationPacketJson(...args) {
    const result = packet.preparationPacketJson(...args); exports++;
    if (exports === 1) {
      if (action === "Clear") button(h, "Clear preparation packet")();
      else if (action === "newer part") textarea(h, "-part-scope").onChange({ currentTarget: { value: "NEWER_PRIVATE_SCOPE" } });
      else button(h, "Read saved preparation packet")();
    }
    return result;
  } } : undefined);
  h = create(c); h.mount(); textarea(h, "-part-scope").onChange({ currentTarget: { value: "CURRENT_UNFINISHED_SCOPE" } });
  textarea(h, "-packet-paste").onChange({ currentTarget: { value: pasted } });
  const picker = () => h.nodes().find(n => n.type === "input" && n.props.type === "file").props;
  try {
    picker().onChange({ currentTarget: { files: [new File([json], "PRIVATE_FINAL_EXPORT.json")], value: "PRIVATE_PATH" } }); await flush();
    assert.equal(exports, 1); assert.equal(picker().disabled, false); assert.equal(output(h), undefined);
    assert.equal(textarea(h, "-part-scope").value, action === "Clear" ? "" : action === "newer part" ? "NEWER_PRIVATE_SCOPE" : "CURRENT_UNFINISHED_SCOPE");
    assert.equal(textarea(h, "-packet-paste").value, action === "Clear" ? "" : pasted);
    if (action === "saved reading") assert.match(renderToStaticMarkup(h.render()), /<h3>Saved preparation reading/);
  } finally { h.unmount(); }
});
