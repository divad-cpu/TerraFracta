import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";

const turn = () => new Promise(setImmediate);
function harness(supervised) {
  const cells = [], layouts = [], effects = []; let cursor = 0;
  const register = (list, callback, deps) => {
    const index = cursor++, old = list[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) list[index] = { callback, deps, pending: true, cleanup: old?.cleanup };
  };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => { cells[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(callback, deps) { register(effects, callback, deps); },
    useLayoutEffect(callback, deps) { register(layouts, callback, deps); },
  };
  const Component = loadTsx(new URL("../src/correction-review-operation-view.tsx", import.meta.url),
    name => name === "react" ? hooks : undefined).CorrectionReviewOperationView;
  const render = () => { cursor = 0; return Component({ supervised }); };
  const setup = list => { for (const item of list) if (item?.pending) { item.cleanup?.(); item.cleanup = item.callback(); item.pending = false; } };
  const unmount = () => { for (const item of [...layouts, ...effects]) item?.cleanup?.(); };
  const mount = () => { render(); setup(layouts); setup(effects); };
  return { mount, unmount, remount() { unmount(); cells.length = 0; layouts.length = 0; effects.length = 0; mount(); },
    html: () => renderToStaticMarkup(render()) };
}

for (const supervised of [false, true]) for (const outcome of ["resolve", "reject", "throw"])
  test(`saved review ${supervised ? "supervised" : "manual"}: request-time remount preserves one physical owner on ${outcome}`, async t => {
    Response.json({ state: "idle" });
    const pending = []; let calls = 0, callsBeforeOriginalReturned, h;
    t.mock.method(globalThis, "fetch", (url, options) => {
      calls++; assert.equal(url, supervised ? "/api/dev/supervised-correction-review" : "/api/dev/correction-review");
      assert.equal(options.method, "GET"); assert.equal(options.body, undefined); assert.equal(options.cache, "no-store");
      let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
      pending.push({ resolve, reject, signal: options.signal });
      if (calls === 1) {
        h.remount(); callsBeforeOriginalReturned = calls;
        if (outcome === "throw") throw Error("PRIVATE_REVIEW_DISPATCH_FAULT");
      }
      return promise;
    });
    h = harness(supervised);
    try {
      h.mount();
      assert.equal(callsBeforeOriginalReturned, 1, "a remounted observer cannot dispatch before the original is registered");
      await turn();
      if (outcome !== "throw") {
        assert.equal(calls, 1); assert.equal(pending[0].signal.aborted, true);
        assert.match(h.html(), /previous saved-result read is still finishing/);
        if (outcome === "reject") pending[0].reject(Error("PRIVATE_OLD_REVIEW_FAILURE"));
        else pending[0].resolve(Response.json({ state: "idle" }));
        await turn();
      }
      assert.equal(calls, 2, "the new admitted observer reads only after original settlement");
      assert.doesNotMatch(h.html(), /PRIVATE_|Four invented reports|worker had finished/);
      pending.at(-1).resolve(Response.json({ state: "held", reason: "private_test_unavailable" }));
      await turn(); assert.equal(calls, 2); assert.doesNotMatch(h.html(), /PRIVATE_|Four invented reports|worker had finished/);
    } finally { h.unmount(); pending.forEach(item => item.resolve(Response.json({ state: "idle" }))); await turn(); }
  });
