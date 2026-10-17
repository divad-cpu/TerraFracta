import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { packetFileHarnessFactory } from "./helpers/packet_file_shared_harness.mjs";
import { packetContext, packetParts } from "./helpers/preparation_packet_fixture.mjs";
import { preparationPacketFromParts, preparationPacketJson } from "../src/preparation-packet.ts";
import * as packet from "../src/preparation-packet.ts";
const flush = () => new Promise(resolve => setImmediate(resolve));
const button = (h, text) => h.nodes().find(n => n.type === "button" && n.props.children === text)?.props.onClick ?? assert.fail(text);
const textarea = (h, suffix) => h.nodes().find(n => n.type === "textarea" && n.props.id?.endsWith(suffix)).props;
const picker = (h, readOnly = false) => h.nodes().find(n => n.type === "input" && n.props.id?.endsWith(readOnly ? "-packet-read-file" : "-packet-file"))?.props ?? assert.fail("Read-only local File selector missing");
const output = h => h.nodes().find(n => n.type === "textarea" && n.props.readOnly)?.props.value;
const body = h => renderToStaticMarkup(h.render());
const sample = () => { const c = packetContext(), parts = packetParts(c); return { c, parts, json: preparationPacketJson(preparationPacketFromParts(parts, c), c) }; };
const choose = (h, file, readOnly = true) => picker(h, readOnly).onChange({ currentTarget: { files: [file], value: "PRIVATE_LOCAL_PATH" } });
function delayedFile(json) {
  const bytes = new TextEncoder().encode(json); let settle, reads = 0;
  const pending = new Promise(resolve => { settle = resolve; });
  return { file: { size: bytes.byteLength, slice: () => ({ arrayBuffer() { reads++; return pending; } }) },
    finish: () => settle(bytes.buffer), get reads() { return reads; } };
}

test("an explicit read-only File selection preserves typed and pasted material until a separate current apply action", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No upload or source request permitted"));
  const { c, parts, json } = sample(), h = packetFileHarnessFactory()(c); h.mount();
  textarea(h, "-part-scope").onChange({ currentTarget: { value: "CURRENT_UNFINISHED_SCOPE" } });
  textarea(h, "-packet-paste").onChange({ currentTarget: { value: "CURRENT_UNFINISHED_PASTE" } });
  choose(h, new File([json], "PRIVATE_FILE_NAME.json")); await flush();
  assert.match(body(h), /<h3>Saved preparation reading/); assert.match(body(h), /What Reopen would do to typed copies/);
  assert.equal(textarea(h, "-part-scope").value, "CURRENT_UNFINISHED_SCOPE"); assert.equal(textarea(h, "-packet-paste").value, "CURRENT_UNFINISHED_PASTE");
  assert.equal(output(h), undefined); assert.doesNotMatch(body(h), /PRIVATE_FILE_NAME|PRIVATE_LOCAL_PATH/);
  button(h, "Reopen read preparation packet")(); assert.equal(output(h), json);
  for (const [name, value] of Object.entries(parts)) assert.equal(textarea(h, `-part-${name}`).value, value);
  assert.equal(textarea(h, "-packet-paste").value, json); assert.doesNotMatch(body(h), /<h3>Saved preparation reading/); h.unmount();
});

test("two labelled local File selectors start disabled and pasted-only reading cannot acquire file-apply authority", () => {
  const { c, json } = sample(), h = packetFileHarnessFactory()(c), initial = body(h);
  const files = h.nodes().filter(n => n.type === "input" && n.props.type === "file"); assert.equal(files.length, 2);
  for (const file of files) { assert.equal(file.props.disabled, true); assert.ok(initial.includes(`for="${file.props.id}"`)); }
  assert.doesNotMatch(initial, /Reopen read preparation packet|<form|type="submit"/);
  h.mount(); textarea(h, "-packet-paste").onChange({ currentTarget: { value: json } }); button(h, "Read saved preparation packet")();
  assert.match(body(h), /<h3>Saved preparation reading/); assert.doesNotMatch(body(h), /Reopen read preparation packet/); h.unmount();
});

test("malformed or foreign File copies cannot replace typed text or acquire a partial saved read or apply action", async () => {
  const { c, json } = sample(), foreign = JSON.parse(json); foreign.binding.captureId = "87000000-0000-4000-8000-000000000991";
  for (const value of [json + "\n", JSON.stringify(foreign, null, 2)]) {
    const h = packetFileHarnessFactory()(c); h.mount(); textarea(h, "-part-scope").onChange({ currentTarget: { value: "CURRENT_TYPED_COPY" } });
    textarea(h, "-packet-paste").onChange({ currentTarget: { value: "CURRENT_PASTED_COPY" } });
    choose(h, new File([value], "PRIVATE_BAD_FILE.json")); await flush();
    assert.equal(textarea(h, "-part-scope").value, "CURRENT_TYPED_COPY"); assert.equal(textarea(h, "-packet-paste").value, "CURRENT_PASTED_COPY");
    assert.equal(output(h), undefined); assert.match(body(h), /Local packet file held/);
    assert.doesNotMatch(body(h), /<h3>Saved preparation reading|Reopen read preparation packet|PRIVATE_BAD_FILE|PRIVATE_LOCAL_PATH/); h.unmount();
  }
});

test("new typed paste Clear context and unmount retire every older read-file apply callback", async () => {
  for (const action of ["part", "paste", "Clear", "context", "unmount"]) {
    const { c, json } = sample(), h = packetFileHarnessFactory()(c); h.mount(); choose(h, new File([json], "private.json")); await flush();
    const apply = button(h, "Reopen read preparation packet");
    if (action === "part") textarea(h, "-part-scope").onChange({ currentTarget: { value: "NEWER_PART" } });
    if (action === "paste") textarea(h, "-packet-paste").onChange({ currentTarget: { value: "NEWER_PASTE" } });
    if (action === "Clear") button(h, "Clear preparation packet")();
    if (action === "context") { const next = structuredClone(c); next.binding.captureId = "87000000-0000-4000-8000-000000000992"; h.render(next); }
    if (action === "unmount") h.unmount(); apply();
    assert.equal(output(h), undefined); assert.doesNotMatch(body(h), /<h3>Saved preparation reading|Reopen read preparation packet/);
    if (action === "part") assert.equal(textarea(h, "-part-scope").value, "NEWER_PART");
    if (action === "paste") assert.equal(textarea(h, "-packet-paste").value, "NEWER_PASTE"); h.unmount();
  }
});

test("both selectors share one physical slot and a superseded read never auto-applies or retries", async () => {
  const { c, json } = sample(), first = delayedFile(json), second = delayedFile(json), h = packetFileHarnessFactory()(c); h.mount();
  try {
    choose(h, first.file); assert.equal(first.reads, 1); assert.equal(picker(h).disabled, true); assert.equal(picker(h, true).disabled, true);
    choose(h, second.file, false); assert.equal(second.reads, 0); first.finish(); await flush();
    assert.equal(output(h), undefined); assert.doesNotMatch(body(h), /Reopen read preparation packet/); assert.equal(picker(h, true).disabled, false);
    choose(h, second.file, false); assert.equal(second.reads, 1); second.finish(); await flush(); assert.equal(output(h), json);
  } finally { first.finish(); second.finish(); await flush(); h.unmount(); }
});

test("unmount during read-only File work keeps both controls waiting on a fresh same-capture visit until physical settlement", async () => {
  const { c, json } = sample(), delayed = delayedFile(json), create = packetFileHarnessFactory(), first = create(c), next = create(c); first.mount();
  try {
    choose(first, delayed.file); first.unmount(); next.mount(); assert.equal(picker(next).disabled, true); assert.equal(picker(next, true).disabled, true);
    delayed.finish(); await flush(); assert.equal(picker(next).disabled, false); assert.equal(picker(next, true).disabled, false);
    assert.equal(output(next), undefined); assert.doesNotMatch(body(next), /Reopen read preparation packet/); assert.equal(delayed.reads, 1);
    choose(next, new File([json], "private.json")); await flush(); assert.match(body(next), /Reopen read preparation packet/);
  } finally { delayed.finish(); await flush(); first.unmount(); next.unmount(); }
});

test("a newer typed intent denies the delayed read-only File result and preserves the pasted copy", async () => {
  const { c, json } = sample(), delayed = delayedFile(json), h = packetFileHarnessFactory()(c); h.mount();
  textarea(h, "-packet-paste").onChange({ currentTarget: { value: "CURRENT_PASTED_COPY" } });
  try {
    choose(h, delayed.file); textarea(h, "-part-scope").onChange({ currentTarget: { value: "NEWER_TYPED_COPY" } });
    delayed.finish(); await flush(); assert.equal(textarea(h, "-part-scope").value, "NEWER_TYPED_COPY");
    assert.equal(textarea(h, "-packet-paste").value, "CURRENT_PASTED_COPY"); assert.equal(output(h), undefined);
    assert.doesNotMatch(body(h), /Reopen read preparation packet/); assert.equal(picker(h, true).disabled, false);
  } finally { delayed.finish(); await flush(); h.unmount(); }
});

test("an old context's physical completion cannot release a newer context's read-only File slot", async () => {
  const { c, json } = sample(), next = structuredClone(c); next.binding.captureId = "87000000-0000-4000-8000-000000000993";
  const nextJson = preparationPacketJson(preparationPacketFromParts(packetParts(next), next), next);
  const oldFile = delayedFile(json), newFile = delayedFile(nextJson), create = packetFileHarnessFactory(), previous = create(c), h = create(next); previous.mount();
  try {
    choose(previous, oldFile.file); previous.unmount(); h.mount(); choose(h, newFile.file); assert.equal(newFile.reads, 1);
    oldFile.finish(); await flush(); assert.equal(picker(h).disabled, true); assert.equal(picker(h, true).disabled, true); assert.doesNotMatch(body(h), /Reopen read preparation packet/);
    newFile.finish(); await flush(); assert.equal(picker(h, true).disabled, false); button(h, "Reopen read preparation packet")(); assert.equal(output(h), nextJson);
  } finally { oldFile.finish(); newFile.finish(); await flush(); previous.unmount(); h.unmount(); }
});

test("the same component refuses a new-context File read until its earlier physical read settles and requires explicit reselection", async () => {
  const { c, json } = sample(), next = structuredClone(c); next.binding.captureId = "87000000-0000-4000-8000-000000000994";
  const nextJson = preparationPacketJson(preparationPacketFromParts(packetParts(next), next), next);
  const oldFile = delayedFile(json), newFile = delayedFile(nextJson), h = packetFileHarnessFactory()(c); h.mount();
  try {
    choose(h, oldFile.file); h.render(next); h.commit(); choose(h, newFile.file); assert.equal(newFile.reads, 0);
    assert.match(body(h), /another local packet read owned the slot/); oldFile.finish(); await flush();
    assert.equal(newFile.reads, 0); assert.doesNotMatch(body(h), /Reopen read preparation packet/);
    choose(h, newFile.file); assert.equal(newFile.reads, 1); newFile.finish(); await flush();
    button(h, "Reopen read preparation packet")(); assert.equal(output(h), nextJson);
  } finally { oldFile.finish(); newFile.finish(); await flush(); h.unmount(); }
});

test("final read-only File export cannot restore a preview after a newer Clear", async () => {
  const { c, json } = sample(); let h, exports = 0;
  const create = packetFileHarnessFactory(name => name === "./preparation-packet.ts" ? { ...packet, preparationPacketJson(...args) {
    const result = preparationPacketJson(...args); exports++; button(h, "Clear preparation packet")(); return result;
  } } : undefined);
  h = create(c); h.mount(); choose(h, new File([json], "private.json")); await flush();
  assert.equal(exports, 1); assert.equal(output(h), undefined); assert.equal(textarea(h, "-packet-paste").value, "");
  assert.doesNotMatch(body(h), /Reopen read preparation packet|<h3>Saved preparation reading/); assert.equal(picker(h, true).disabled, false); h.unmount();
});
