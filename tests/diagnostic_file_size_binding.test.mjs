import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDiagnosticReport } from "../src/diagnostic-report.ts";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { readDiagnosticExport, DIAGNOSTIC_IMPORT_BYTES } from "../src/diagnostic-import.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const event = makeDiagnosticEvent("weekly_assessment_export", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", new Date("2026-10-03T12:00:00.000Z"));
const report = buildDiagnosticReport({ events: [event], unreadable: 0, filesObserved: 1, stable: true, locked: false }, new Date("2026-10-03T13:00:00.000Z"));
const body = JSON.stringify(report), bytes = () => new TextEncoder().encode(body).buffer;
const turn = () => new Promise(resolve => setImmediate(resolve));
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
function ui(t) {
  let cursor = 0, effect, cleanup, layout, layoutCleanup; const cells = [];
  const hooks = {
    useState(initial) { const i = cursor++; cells[i] ??= initial; return [cells[i], value => { cells[i] = typeof value === "function" ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; cells[i] ??= { current: initial }; return cells[i]; },
    useEffect(value) { effect = value; }, useLayoutEffect(value) { layout = value; }, useId() { return "diagnostic-file-size"; },
  };
  const Component = loadTsx(new URL("../src/diagnostic-import-view.tsx", import.meta.url), name => name === "react" ? hooks : undefined).DiagnosticImportView;
  const render = () => { cursor = 0; return Component(); };
  t.mock.method(globalThis, "fetch", () => assert.fail("Diagnostic file selection used a transport"));
  t.after(() => { layoutCleanup?.(); cleanup?.(); });
  return { mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); }, markup: () => renderToStaticMarkup(render()),
    choose(file) { const input = { files: [file], value: "PRIVATE_DIAGNOSTIC_FILENAME" };
      nodes(render()).find(node => node.type === "input" && node.props.type === "file").props.onChange({ currentTarget: input });
      assert.equal(input.value, ""); }, };
}

test("diagnostic selection captures native file size once and binds the complete historical report", async t => {
  const h = ui(t); let gets = 0, slices = 0;
  h.mount(); h.choose({ get size() { return ++gets === 1 ? bytes().byteLength : -1; }, slice(start, end) {
    slices++; assert.equal(start, 0); assert.equal(end, DIAGNOSTIC_IMPORT_BYTES + 1); return { arrayBuffer: async () => bytes() };
  } }); await turn(); assert.equal(gets, 1); assert.equal(slices, 1);
  const html = h.markup(); assert.match(html, /1 validated records/); assert.ok(html.includes(event.eventId));
  assert.match(html, /dated claims, not an authenticated archive/); assert.doesNotMatch(html, /PRIVATE_/);
});

test("shadowed buffer byteLength cannot satisfy a false local file size", async t => {
  const h = ui(t), buffer = bytes(); Object.defineProperty(buffer, "byteLength", { value: 2 });
  h.mount(); h.choose({ size: 2, slice() { return { arrayBuffer: async () => buffer }; } }); await turn();
  assert.match(h.markup(), /could not be read/); assert.ok(!h.markup().includes(event.eventId)); assert.doesNotMatch(h.markup(), /PRIVATE_/);
});

test("optional expected size uses native bytes and preserves the original decoder API", () => {
  const buffer = bytes(), size = new Uint8Array(buffer).length;
  Object.defineProperty(buffer, "byteLength", { value: 1 });
  assert.deepEqual(readDiagnosticExport(buffer), report); assert.deepEqual(readDiagnosticExport(buffer, size), report);
  for (const expected of [0, 1, 2, size - 1, size + 1, DIAGNOSTIC_IMPORT_BYTES + 1, NaN, Infinity, size + 0.5])
    assert.throws(() => readDiagnosticExport(buffer, expected));
});

test("metadata quota and throwing size fail before slice and keep refusals opaque", async t => {
  const h = ui(t); let slices = 0, gets = 0; h.mount();
  for (const size of [0, 1, DIAGNOSTIC_IMPORT_BYTES + 1, NaN, Infinity, 2.5]) {
    h.choose({ size, slice() { slices++; assert.fail("Refused metadata read bytes"); } }); await turn();
    assert.match(h.markup(), /could not be read/); assert.ok(!h.markup().includes(event.eventId));
  }
  h.choose({ get size() { gets++; throw new Error("PRIVATE_DIAGNOSTIC_SIZE"); }, slice() { slices++; } }); await turn();
  assert.equal(gets, 1); assert.equal(slices, 0); assert.match(h.markup(), /could not be read/); assert.doesNotMatch(h.markup(), /PRIVATE_/);
});

test("native File still opens exact references without upload, filename, link or archive action", async t => {
  const h = ui(t); h.mount(); h.choose(new File([body], "PRIVATE_DIAGNOSTIC_FILENAME.json", { type: "application/json" })); await turn();
  const html = h.markup(); assert.ok(html.includes(event.eventId)); assert.ok(html.includes(event.occurredAt));
  assert.match(html, /capture coverage is unknown|untrusted evidence/); assert.doesNotMatch(html, /PRIVATE_|<a |\/api\//);
});

test("expected-size check cannot replace malformed UTF-8 or closed report privacy checks", () => {
  for (const buffer of [new Uint8Array([0xff, 0xff]).buffer, new TextEncoder().encode("{}").buffer,
    new TextEncoder().encode(JSON.stringify({ ...report, privateBody: "PRIVATE_REPORT" })).buffer,
    new ArrayBuffer(DIAGNOSTIC_IMPORT_BYTES + 1)]) {
    assert.throws(() => readDiagnosticExport(buffer, new Uint8Array(buffer).length));
  }
});
