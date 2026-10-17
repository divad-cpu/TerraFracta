import assert from "node:assert/strict";
import test from "node:test";
import { parentSourceHarness } from "./helpers/parent_source_harness.mjs";
import { copyScopeHarness } from "./helpers/copy_scope_harness.mjs";
import { currentPreparationHarness } from "./helpers/current_preparation_harness.mjs";

const turn = () => new Promise(setImmediate);
const variants = [
  { name: "parent source", harness: parentSourceHarness, endpoint: "/api/dev/parent-source", reason: "parent_source_comparison_unavailable" },
  { name: "copy scope", harness: copyScopeHarness, endpoint: "/api/dev/copy-scope", reason: "copy_observation_unavailable" },
  { name: "private preparation", harness: currentPreparationHarness, endpoint: "/api/dev/source-readiness", reason: "local_observation_unavailable" },
];

for (const v of variants) for (const originalThrows of [false, true])
  test(`${v.name}: request-time remount cannot overlap physical reads, original throws ${originalThrows}`, async t => {
    // Native Request/Response initialization precedes the one injected fetch port.
    const held = () => Response.json({ state: "held", reason: v.reason });
    held();
    const pending = []; let calls = 0, h;
    t.mock.method(globalThis, "fetch", (url, options) => {
      calls++; assert.equal(url, v.endpoint); assert.equal(options.method, "GET");
      assert.equal(options.cache, "no-store"); assert.equal(options.body, undefined);
      if (calls === 1) {
        h.remount(); h.button().onClick();
        if (originalThrows) throw Error("PRIVATE_ORIGINAL_READ_FAULT");
      }
      return new Promise(resolve => pending.push({ resolve, signal: options.signal }));
    });
    h = v.harness(); h.mount();
    try {
      h.button().onClick(); await turn();
      assert.equal(calls, 1, "the new visit cannot dispatch while the original invocation owns admission");
      assert.doesNotMatch(h.markup(), /PRIVATE_|Observed <time/);
      if (!originalThrows) {
        assert.equal(pending.length, 1); assert.equal(pending[0].signal.aborted, true);
        assert.equal(h.button().disabled, true);
        pending[0].resolve(held()); await turn();
      }
      assert.equal(h.button().disabled, false, "the new visit becomes available only after the original settles");
      assert.equal(calls, 1, "settlement never starts an implicit request");
      h.button().onClick(); await turn(); assert.equal(calls, 2); assert.equal(h.button().disabled, true);
      h.button().onClick(); assert.equal(calls, 2);
      pending.at(-1).resolve(held()); await turn(); assert.equal(h.button().disabled, false);
      assert.doesNotMatch(h.markup(), /PRIVATE_|Observed <time/);
    } finally {
      h.unmount(); pending.forEach(item => item.resolve(held())); await turn();
    }
  });
