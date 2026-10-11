import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";

const id = "11111111-1111-4111-8111-111111111111";
const bytes = new TextEncoder().encode(JSON.stringify({ eventId: id, code: "browser_runtime" }));
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
for (const timing of ["timely", "boundary-chunk", "late-chunk", "boundary-eof", "late-eof", "backward", "invalid-start", "invalid-settlement", "timer-fired", "abort-before", "abort-during"]) {
  test(`diagnostic intake body: ${timing}, without relying on a punctual timer`, async t => {
    let clock = timing === "invalid-start" ? NaN : 100, timer, saves = 0;
    t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
      assert.equal(milliseconds, 1_000);timer = { callback, cleared: false };return timer;
    });
    t.mock.method(globalThis, "clearTimeout", value => { if (value) value.cleared = true; });
    let source;
    const body = new ReadableStream({ start(value) { source = value; } });
    const caller = new AbortController();
    if (timing === "abort-before") caller.abort();
    const request = new Request("http://127.0.0.1:3000/api/dev/error-log", {
      method: "POST", body, duplex: "half", signal: caller.signal,
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
    });
    const intake = createDiagnosticIntake(async (...args) => {
      saves++;assert.deepEqual(args, ["browser_runtime", id]);return "saved";
    }, () => clock);
    const pending = intake(request, "development");
    await tick();assert.equal(saves, 0);
    if (timing === "invalid-start") {
      assert.equal(timer, undefined);source.close();
    } else if (timing === "abort-before") {
      // Its native reader may already have been cancelled by the settled race.
    } else if (timing === "abort-during") {
      caller.abort();
    } else if (timing === "timer-fired") {
      clock = 1_600;timer.callback();
    } else if (timing.endsWith("eof")) {
      source.enqueue(bytes);await tick();assert.equal(saves, 0);
      clock = timing === "boundary-eof" ? 1_100 : 1_600;source.close();
    } else {
      clock = timing === "timely" ? 1_099 : timing === "boundary-chunk" ? 1_100 :
        timing === "backward" ? 99 : timing === "invalid-settlement" ? Infinity : 1_600;
      source.enqueue(bytes);source.close();
    }
    const response = await pending;
    assert.equal(response.status, timing === "timely" ? 204 : timing === "invalid-start" ? 503 : 400);
    assert.equal(await response.text(), "");assert.equal(saves, timing === "timely" ? 1 : 0);
    if (timer) assert.equal(timer.cleared, true);
  });
}
