import assert from "node:assert/strict";
import test from "node:test";
import { weeklyStatusHarness } from "./helpers/weekly_status_harness.mjs";
import { exportWeeklyRehearsal } from "../src/weekly-rehearsal-export.ts";

const observed = { state: "observed", observation: {
  schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-03T14:36:03.626268+00:00",
  dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed",
  coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false,
  trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0,
} };
const turn = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
  const requests = [], codes = [];
  t.mock.method(globalThis, "fetch", (url, options) => {
    assert.equal(url, "/api/dev/update-rehearsal/status"); assert.equal(options.method, "GET");
    if (requests.length === 0) { requests.push(null); return Promise.resolve(Response.json(observed)); }
    return new Promise(resolve => requests.push(resolve));
  });
  const ui = weeklyStatusHarness(code => codes.push(code));
  ui.mount(); ui.button().onClick(); await turn();
  assert.equal(ui.buttons().length, 2);
  t.after(() => ui.unmount());
  return { ui, codes, requests };
}

function ports(t, stage, retire, fail = false) {
  const calls = [], blobs = [], deferred = []; let retired = false;
  const step = name => {
    calls.push(name);
    if (name === stage && !retired) {
      retired = true; retire();
      if (fail) throw new Error("PRIVATE_RETIRED_EXPORT");
    }
  };
  const link = { click: () => step("click"), remove: () => step("remove") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement(tag) { assert.equal(tag, "a"); step("create"); return link; },
    body: { append(value) { assert.equal(value, link); step("append"); } },
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document; });
  t.mock.method(URL, "createObjectURL", blob => { blobs.push(blob); step("url"); return "blob:weekly-owned"; });
  t.mock.method(URL, "revokeObjectURL", value => { assert.equal(value, "blob:weekly-owned"); calls.push("revoke"); });
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => {
    assert.ok([1_000, 8_000].includes(milliseconds));
    if (milliseconds === 1_000) deferred.push(callback);
    return { milliseconds };
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  return { calls, blobs, deferred, link };
}

for (const stage of ["url", "create", "append"]) for (const mode of ["refresh", "recreate"]) {
  test(`weekly export stops after ${stage} retires its ${mode === "refresh" ? "observation" : "visit"}`, async t => {
    const { ui, codes, requests } = await fixture(t), download = ui.buttons()[1].onClick;
    const native = ports(t, stage, () => mode === "refresh" ? ui.button().onClick() : (ui.unmount(), ui.mount()));
    assert.doesNotThrow(download);
    assert.ok(!native.calls.includes("click"), "retired selection requested a download");
    if (stage === "url") assert.ok(!native.calls.includes("create"));
    if (stage === "create") assert.ok(!native.calls.includes("append"));
    if (stage !== "url") assert.ok(native.calls.includes("remove"));
    assert.doesNotMatch(ui.markup(), /Download requested|could not be exported|PRIVATE_/);
    assert.deepEqual(codes, []);
    for (const callback of native.deferred) callback();
    assert.ok(native.calls.includes("revoke"));
    if (mode === "refresh") { requests[1](Response.json({ state: "held", reason: "weekly_rehearsal_unavailable" })); await turn(); }
    download(); assert.equal(native.blobs.length, 1, "a retired callback revived");
  });
}

for (const stage of ["url", "create", "append", "click"]) {
  test(`weekly ${stage} failure after retirement cannot diagnose or message a successor`, async t => {
    const { ui, codes, requests } = await fixture(t);
    const native = ports(t, stage, () => ui.button().onClick(), true);
    assert.doesNotThrow(ui.buttons()[1].onClick);
    assert.deepEqual(codes, [], "retired fault entered the diagnostic stream");
    assert.doesNotMatch(ui.markup(), /Download requested|could not be exported|PRIVATE_/);
    for (const callback of native.deferred) callback();
    if (stage !== "url") assert.ok(native.calls.includes("revoke"));
    requests[1](Response.json({ state: "held", reason: "weekly_rehearsal_unavailable" })); await turn();
    assert.doesNotMatch(ui.markup(), /Download requested|could not be exported|PRIVATE_/);
  });
}

test("retirement during click suppresses its old completion notice without undoing the requested click", async t => {
  const { ui, codes, requests } = await fixture(t);
  const native = ports(t, "click", () => ui.button().onClick());
  ui.buttons()[1].onClick(); assert.equal(native.calls.filter(value => value === "click").length, 1);
  assert.doesNotMatch(ui.markup(), /Download requested|could not be exported/); assert.deepEqual(codes, []);
  for (const callback of native.deferred) callback();
  assert.ok(native.calls.includes("remove")); assert.ok(native.calls.includes("revoke"));
  requests[1](Response.json({ state: "held", reason: "weekly_rehearsal_unavailable" })); await turn();
});

test("a current weekly download retains exact historical bytes, filename and independent cleanup", async t => {
  const { ui, codes, requests } = await fixture(t), native = ports(t, "none", () => assert.fail("unexpected retirement"));
  ui.buttons()[1].onClick();
  assert.equal(await native.blobs[0].text(), exportWeeklyRehearsal(observed).body);
  assert.equal(native.link.download, "terrafracta-weekly-rehearsal-2026-W40.json");
  assert.deepEqual(native.calls, ["url", "create", "append", "click", "remove"]);
  assert.match(ui.markup(), /Download requested/); assert.doesNotMatch(ui.markup(), /file was saved|download completed/);
  assert.equal(native.deferred.length, 1); native.deferred[0](); assert.equal(native.calls.at(-1), "revoke");
  assert.equal(requests.length, 1); assert.deepEqual(codes, []);
});
