import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createPrivateCustodianHandler } from "../src/server/private-custodian-operation.ts";
import { handleFictionalUpdateRequest } from "../src/server/fictional-update-operation.ts";

const saved = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

for (const kind of ["custodian", "update"]) {
  for (const timing of ["timely", "boundary-chunk", "late-chunk", "boundary-eof", "late-eof", "backward", "invalid-start", "invalid-settlement", "timer-fired"]) {
    test(`${kind} body admission: ${timing}, with a delayed deadline callback`, async t => {
      let clock = timing === "invalid-start" ? NaN : 100, bodyTimer;
      let started = 0, observed = 0, savedReceipts = 0, diagnostics = 0;
      t.mock.method(performance, "now", () => clock);
      t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
        const timer = { callback, milliseconds, cleared: false };
        if (milliseconds === 2_000) bodyTimer = timer;
        return timer;
      });
      t.mock.method(globalThis, "clearTimeout", timer => { if (timer) timer.cleared = true; });
      let controller;
      const stream = new ReadableStream({ start(value) { controller = value; } });
      const action = kind === "custodian" ? '{"action":"run_invented_custodian"}' : '{"trigger":"manual"}';
      const request = new Request(`http://127.0.0.1:3000/api/dev/${kind === "custodian" ? "private-custodian" : "update-rehearsal"}`, {
        method: "POST", body: stream, duplex: "half",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
      });
      const record = async () => { diagnostics++; return "unavailable"; };
      const handler = kind === "custodian" ? createPrivateCustodianHandler({
        inspect: async () => { observed++; return { state: "idle" }; },
        start: async () => { started++; return { state: "held", reason: "private_test_unavailable" }; },
      }, { status: { state: "idle" } }, record) : (input, environment) => handleFictionalUpdateRequest(input, environment,
        async () => { started++; return { ...structuredClone(saved), trigger: "manual", scheduledDueAt: null,
          requestKey: "fictional:manual:2026w40" }; }, async () => { savedReceipts++; }, record);
      const pending = handler(request, "development");
      await tick();
      assert.equal(started, 0);
      if (timing === "invalid-start") {
        assert.equal(bodyTimer, undefined, "invalid start refuses without a timer or read lock");
        controller.close();
      } else {
        assert.equal(bodyTimer?.milliseconds, 2_000);
        if (timing.endsWith("eof")) {
          controller.enqueue(new TextEncoder().encode(action));
          await tick();
          assert.equal(started, 0, "grammar acceptance also requires timely EOF");
          clock = timing === "boundary-eof" ? 2_100 : 2_600;
          controller.close();
        } else if (timing === "timer-fired") {
          clock = 2_600;
          bodyTimer.callback();
        } else {
          clock = timing === "timely" ? 2_099 : timing === "boundary-chunk" ? 2_100 :
            timing === "backward" ? 99 : timing === "invalid-settlement" ? Infinity : 2_600;
          controller.enqueue(new TextEncoder().encode(action));
          controller.close();
        }
      }
      const response = await pending;
      await tick();
      if (timing === "timely") {
        assert.equal(response.status, kind === "custodian" ? 202 : 200);
        assert.equal(started, 1);
        assert.equal(savedReceipts, kind === "update" ? 1 : 0);
      } else {
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: kind === "custodian" ? "invalid_private_test_request" : "invalid_rehearsal_request" });
        assert.equal(started, 0);
        assert.equal(observed, 0);
        assert.equal(savedReceipts, 0);
      }
      assert.equal(diagnostics, 0, "body refusal is expected validation");
      if (bodyTimer) assert.equal(bodyTimer.cleared, true);
    });
  }
}
