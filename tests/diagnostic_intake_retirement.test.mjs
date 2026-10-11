import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticIntake } from "../src/server/error-log-intake.ts";

const intent = { eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", code: "browser_runtime" };
function request(body = JSON.stringify(intent), signal) {
  return new Request("http://127.0.0.1/api/dev/error-log", { method: "POST", body, signal,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "sec-fetch-site": "same-origin", "content-type": "application/json" },
  });
}
function ownReader(t, req, refuseCancel = false) {
  const getReader = req.body.getReader.bind(req.body), calls = { cancel: 0, release: 0 };
  t.mock.method(req.body, "getReader", (...args) => {
    const reader = getReader(...args), cancel = reader.cancel.bind(reader), release = reader.releaseLock.bind(reader);
    t.mock.method(reader, "cancel", (...args) => { calls.cancel++; if (refuseCancel) throw Error("PRIVATE_CANCEL_FAILURE"); return cancel(...args); });
    t.mock.method(reader, "releaseLock", (...args) => { calls.release++; return release(...args); });
    return reader;
  });
  return calls;
}

for (const refuseCancel of [false, true]) test(`validated intake preserves its original decision and independently retires its body (cancel refusal=${refuseCancel})`, async t => {
  const req = request(), calls = ownReader(t, req, refuseCancel); let saves = 0;
  t.mock.method(req.signal, "removeEventListener", () => { throw Error("PRIVATE_LISTENER_RETIREMENT"); });
  const intake = createDiagnosticIntake(async (code, eventId) => { assert.equal(code, intent.code); assert.equal(eventId, intent.eventId); saves++; return "saved"; });
  const response = await intake(req, "development");
  assert.deepEqual({ status: response.status, locked: req.body.locked, ...calls, saves }, { status: 204, locked: false, cancel: 1, release: 1, saves: 1 });
  assert.equal(await response.text(), ""); assert.equal(response.headers.get("cache-control"), "no-store");
});

test("cancelled pending intake retires its actual native reader despite listener removal refusal and never writes", async t => {
  const controller = new AbortController(), req = request(new ReadableStream({ start() {} }), controller.signal);
  const calls = ownReader(t, req); let saves = 0;
  t.mock.method(req.signal, "removeEventListener", () => { throw Error("PRIVATE_LISTENER_RETIREMENT"); });
  const intake = createDiagnosticIntake(async () => { saves++; return "saved"; });
  const pending = intake(req, "development"); controller.abort(); const response = await pending;
  assert.deepEqual({ status: response.status, locked: req.body.locked, ...calls, saves }, { status: 400, locked: false, cancel: 1, release: 1, saves: 0 });
  assert.equal(await response.text(), "");
});
