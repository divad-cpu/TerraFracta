import assert from "node:assert/strict";
import test from "node:test";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";
import { handleFictionalHistoryPageRequest } from "../src/server/fictional-receipt-page.ts";

const text = tree => Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : String(tree ?? "");
function history() {
  let cursor = 0, effect, cleanup, layout, layoutCleanup, paused = false; const cells = [], queued = [], logs = [];
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = initial;
      return [cells[slot], value => {
        const apply = () => { cells[slot] = typeof value === "function" ? value(cells[slot]) : value; };
        if (paused && typeof value === "function") queued.push(apply); else apply();
      }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot]; },
    useLayoutEffect(callback) { layout = callback; }, useEffect(callback) { effect = callback; },
  };
  const Component = loadTsx(new URL("../app/update-preview/history.tsx", import.meta.url), name => name === "react" ? hooks : name.endsWith("client-error-diagnostics.ts") ? { observeClientError: code => logs.push(code) } : undefined).FictionalHistory;
  const render = () => { cursor = 0; return Component({ onInspect() { assert.fail("Unexpected inspection"); } }); };
  const controls = tree => elements(tree).filter(node => node.type === "select");
  return { render, logs, controls, mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); }, unmount() { layoutCleanup?.(); cleanup?.(); },
    pause() { paused = true; }, flush() { paused = false; for (const apply of queued.splice(0)) apply(); },
    button(label, tree = render()) { const node = elements(tree).find(node => node.type === "button" && text(node) === label); assert.ok(node, label); return node.props; },
    form(tree = render()) { return elements(tree).find(node => node.type === "form").props; },
    values: () => controls(render()).map(node => node.props.value),
  };
}
function transport(t, pending) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, method: options.method, body: options.body, signal: options.signal });
    if (pending) await pending;
    return handleFictionalHistoryPageRequest(new Request(new URL(url, "http://127.0.0.1:3000"), { headers: { "sec-fetch-site": "same-origin" }, signal: options.signal }), "development", async () => ({ entries: [], totalReceipts: 0, unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true }));
  });
  return calls;
}
const turn = () => new Promise(resolve => setImmediate(resolve));
test("same-render history filter changes preserve both selections and the next read uses that combined intent", async t => {
  const ui = history(), calls = transport(t); ui.mount();
  try {
    const fields = ui.controls(ui.render());
    fields[0].props.onChange({ target: { value: "missing_source" } });
    fields[1].props.onChange({ target: { value: "scheduled" } });
    assert.deepEqual(ui.values(), ["missing_source", "scheduled"]);
    assert.equal(calls.length, 0);
    ui.button("Load filtered runs").onClick(); await turn();
    assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/dev/update-rehearsal/history/page?scenario=missing_source&trigger=scheduled");
    assert.equal(calls[0].method, "GET"); assert.equal(calls[0].body, undefined); assert.deepEqual(ui.logs, []);
  } finally { ui.unmount(); }
});
test("retired history load submit and reset actions cannot read or erase newer draft filters", async t => {
  for (const action of ["load", "submit", "reset"]) {
    const ui = history(), calls = transport(t); ui.mount();
    try {
      ui.controls(ui.render())[0].props.onChange({ target: { value: "standard" } });
      const prior = ui.render(), old = action === "load" ? ui.button("Load filtered runs", prior).onClick : action === "submit" ? ui.form(prior).onSubmit : ui.button("Show all saved runs", prior).onClick;
      ui.controls(ui.render())[1].props.onChange({ target: { value: "manual" } });
      old({ preventDefault() {} });
      await turn(); assert.equal(calls.length, 0, action); assert.deepEqual(ui.values(), ["standard", "manual"]);
      ui.form().onSubmit({ preventDefault() {} }); await turn();
      assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/dev/update-rehearsal/history/page?scenario=standard&trigger=manual");
      assert.deepEqual(ui.logs, []);
    } finally { ui.unmount(); }
  }
});
test("deferred history selections block stale loads and resets until a consistent draft is rendered", async t => {
  for (const mode of ["batch", "reset"]) {
    const ui = history(), calls = transport(t); ui.mount();
    try {
      ui.controls(ui.render())[0].props.onChange({ target: { value: "standard" } });
      const prior = ui.render(), reset = ui.button("Show all saved runs", prior).onClick;
      ui.pause(); const fields = ui.controls(prior);
      fields[0].props.onChange({ target: { value: "missing_source" } }); fields[1].props.onChange({ target: { value: "scheduled" } });
      // A render with still-pending values must not certify a load of the old scope.
      const pendingLoad = ui.button("Load filtered runs").onClick;
      pendingLoad(); reset(); assert.equal(calls.length, 0);
      ui.flush(); assert.deepEqual(ui.values(), ["missing_source", "scheduled"]);
      if (mode === "reset") {
        ui.pause(); const old = ui.controls(ui.render());
        old[0].props.onChange({ target: { value: "standard" } }); ui.flush();
        const currentReset = ui.button("Show all saved runs").onClick;
        ui.pause(); currentReset();
        old[1].props.onChange(new Proxy({}, { get() { assert.fail("Reset-retired input observed"); } }));
        ui.flush(); await turn(); assert.deepEqual(ui.values(), ["", ""]);
        assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/dev/update-rehearsal/history/page");
      } else { reset(); assert.equal(calls.length, 0); }
      assert.deepEqual(ui.logs, []);
    } finally { ui.flush(); ui.unmount(); }
  }
});
test("physical history reads and cleanup keep denying old filter events and overlapping actions", async t => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const ui = history(), calls = transport(t, pending); ui.mount();
  try {
    const prior = ui.render(), oldInput = ui.controls(prior)[0].props.onChange, oldLoad = ui.button("Load filtered runs", prior).onClick;
    oldLoad(); assert.equal(calls.length, 1);
    oldInput(new Proxy({}, { get() { assert.fail("Busy input observed"); } })); oldLoad(); assert.equal(calls.length, 1);
    finish(); for (let i = 0; i < 20 && elements(ui.render()).some(node => node.type === "button" && text(node) === "Reading…"); i++) await turn();
    assert.equal(ui.button("Load filtered runs").disabled, false);
    const fresh = ui.controls(ui.render())[0].props.onChange;
    ui.unmount(); fresh(new Proxy({}, { get() { assert.fail("Unmounted input observed"); } })); oldLoad();
    assert.equal(calls.length, 1); assert.deepEqual(ui.logs, []);
  } finally { finish(); await turn(); }
});
