import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : [];
function selection() {
  let cursor = 0, effect, current = true; const cells = [], codes = [];
  const hooks = { useRef(value) { const i = cursor++; cells[i] ??= { current: value }; return cells[i]; },
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], next => { cells[i] = next; }]; },
    useId() { return "saved-result"; }, useEffect(fn) { effect = fn; } };
  const view = loadTsx(new URL("../src/fictional-saved-run-view.tsx", import.meta.url), name => name === "react" ? hooks :
    name === "./client-error-diagnostics.ts" ? { observeClientError: code => codes.push(code) } : undefined).FictionalSavedRunView;
  const input = { execution: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "local_fictional", scenario: "standard", executedAt: "2026-10-10T10:00:00Z", durationMs: 1 },
    report: JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url))) };
  const render = () => { cursor = 0; return view({ input, isCurrent: () => current }); };
  render(); const cleanup = effect();
  return { render, codes, cleanup, retire() { current = false; }, action() { return nodes(render()).find(x => x.type === "button").props.onClick; } };
}
function ports(t, ui, phase) {
  const calls = [];
  const link = { remove() { calls.push("remove"); }, click() { calls.push("click"); } };
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => { if (prior) Object.defineProperty(globalThis, "document", prior); else delete globalThis.document; });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement() { calls.push("create"); if (phase === "create") ui.retire(); return link; },
    body: { append() { calls.push("append"); if (phase === "append") ui.retire(); } } } });
  t.mock.method(URL, "createObjectURL", () => { calls.push("url"); return "blob:owned"; });
  t.mock.method(URL, "revokeObjectURL", value => { assert.equal(value, "blob:owned"); calls.push("revoke"); });
  return calls;
}
test("full-result retirement during link creation denies object URL allocation and releases its link", t => {
  const ui = selection(), calls = ports(t, ui, "create");
  try { ui.action()(); assert.deepEqual(calls, ["create", "remove"]); assert.deepEqual(ui.codes, []); }
  finally { ui.cleanup(); }
});
test("full-result retirement during append denies click and releases each allocated native resource", t => {
  const ui = selection(), calls = ports(t, ui, "append");
  try { ui.action()(); assert.deepEqual(calls, ["create", "url", "append", "remove", "revoke"]); assert.deepEqual(ui.codes, []); }
  finally { ui.cleanup(); }
});
