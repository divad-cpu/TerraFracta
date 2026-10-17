import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { elements } from "./helpers/correction_draft_harness.mjs";

const turn = () => new Promise(setImmediate);
function sharedModule(codes) {
  let active;
  const hooks = {
    useState(initial) { const state = active, i = state.cursor++; if (!(i in state.cells)) state.cells[i] = initial;
      return [state.cells[i], value => { state.cells[i] = value; }]; },
    useRef(initial) { const state = active, i = state.cursor++; if (!(i in state.cells)) state.cells[i] = { current: initial }; return state.cells[i]; },
    useEffect(callback, deps) { register(active.effects, callback, deps); },
    useLayoutEffect(callback, deps) { register(active.layouts, callback, deps); },
  };
  function register(list, callback, deps) {
    const i = active.cursor++, old = list[i];
    if (!old || deps.some((value, index) => value !== old.deps[index])) list[i] = { callback, deps, cleanup: old?.cleanup, pending: true };
  }
  const request = loadTsx(new URL("../src/private-custodian-request.ts", import.meta.url),
    name => name === "./client-error-diagnostics.ts" ? { observeClientError: code => codes.push(code) } : undefined);
  const Component = loadTsx(new URL("../src/private-custodian-operation-view.tsx", import.meta.url),
    name => name === "react" ? hooks : name === "./private-custodian-request" ? request : undefined).PrivateCustodianOperationView;
  return () => {
    const state = { cells: [], effects: [], layouts: [], cursor: 0 };
    const render = () => { active = state; state.cursor = 0; return Component(); };
    const setup = list => { for (const item of list) if (item?.pending) { item.cleanup?.(); item.cleanup = item.callback(); item.pending = false; } };
    return { commit() { render(); setup(state.layouts); setup(state.effects); },
      unmount() { for (const item of [...state.layouts, ...state.effects]) item?.cleanup?.(); },
      button: () => elements(render()).find(item => item.type === "button").props,
      html: () => renderToStaticMarkup(render()) };
  };
}

for (const method of ["GET", "POST"]) for (const outcome of ["resolve", "reject", "throw"])
  test(`invented custodian ${method}: request-time replacement waits for original ${outcome} without a new start`, async t => {
    Response.json({ state: "idle" });
    const codes = [], instances = [], requests = [], create = sharedModule(codes);
    let old, next, triggered = false, countBeforeOriginalReturned;
    t.mock.method(globalThis, "fetch", (url, options) => {
      assert.equal(url, "/api/dev/private-custodian"); assert.equal(options.cache, "no-store");
      assert.ok(["GET", "POST"].includes(options.method));
      assert.equal(options.body, options.method === "POST" ? '{"action":"run_invented_custodian"}' : undefined);
      let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
      const item = { method: options.method, signal: options.signal, resolve, reject }; requests.push(item);
      if (!triggered && options.method === method) {
        triggered = true; old.unmount(); next = create(); instances.push(next); next.commit();
        countBeforeOriginalReturned = requests.length;
        if (outcome === "throw") throw Error("PRIVATE_CUSTODIAN_DISPATCH_FAULT");
      }
      return promise;
    });
    old = create(); instances.push(old);
    try {
      old.commit();
      if (method === "POST") { requests[0].resolve(Response.json({ state: "idle" })); await turn(); old.commit();
        assert.equal(old.button().disabled, false); old.button().onClick(); }
      const originalIndex = method === "GET" ? 0 : 1, admitted = originalIndex + 1;
      assert.equal(countBeforeOriginalReturned, admitted, "replacement status cannot start inside an unregistered request");
      await turn();
      if (outcome !== "throw") {
        assert.equal(requests.length, admitted); assert.equal(requests[originalIndex].signal.aborted, true);
        assert.equal(next.button().disabled, true);
        if (outcome === "reject") requests[originalIndex].reject(Error("PRIVATE_OLD_CUSTODIAN_FAULT"));
        else requests[originalIndex].resolve(Response.json({ state: "held", reason: "private_test_unavailable" }));
        await turn();
      }
      assert.equal(requests.length, admitted + 1); assert.equal(requests.at(-1).method, "GET");
      assert.equal(requests.filter(item => item.method === "POST").length, method === "POST" ? 1 : 0);
      assert.doesNotMatch(next.html(), /PRIVATE_|completed cleanly/);
      requests.at(-1).resolve(Response.json({ state: "idle" })); await turn(); next.commit();
      assert.equal(next.button().disabled, false); assert.deepEqual(codes, []);
      assert.equal(requests.filter(item => item.method === "POST").length, method === "POST" ? 1 : 0);
    } finally { instances.forEach(item => item.unmount()); requests.forEach(item => item.resolve(Response.json({ state: "idle" }))); await turn(); }
  });
