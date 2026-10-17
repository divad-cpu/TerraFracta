import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { withLocalRequestDeadline } from "../src/local-request-deadline.ts";
import { correctionReviewExecution } from "./helpers/correction_review_execution.mjs";

const stamp = "2026-10-04T12:00:00Z";
const saved = JSON.parse(readFileSync(new URL("../fixtures/local_private_attempt_readiness_snapshot.json", import.meta.url), "utf8"));
const cases = [
  { file: "current-copy-scope-view.tsx", component: "CurrentCopyScopeView", endpoint: "/api/dev/copy-scope", deadline: 8000,
    visible: /Observed <time/, held: /observation is unavailable/, value: { state: "observed", observation: {
      schemaVersion: 1, evidenceKind: "current_local_copy_scope_observation", recordedAt: stamp,
      pointInTimeOnly: true, state: "held", backupExclusion: "observed", syncSetup: "present",
      otherCopies: "owner_context_pending", allCopyPathsVerified: false, credentialFilesRead: false,
      rawBodiesRead: false, configurationChanged: false, sourceRequests: 0, collectionPermissionIssued: false, publicationEnabled: false } } },
  { file: "current-private-preparation-view.tsx", component: "CurrentPrivatePreparationView", endpoint: "/api/dev/source-readiness", deadline: 12000,
    visible: /Observed <time/, held: /local observation is unavailable/, value: { state: "observed", observation: {
      ...saved, evidenceKind: "current_local_preparation_observation", pointInTimeOnly: true, recordedAt: stamp } } },
  { file: "current-parent-source-view.tsx", component: "CurrentParentSourceView", endpoint: "/api/dev/parent-source", deadline: 8000,
    visible: /Observed <time/, held: /current comparison is unavailable/, value: { state: "observed", observation: {
      schemaVersion: 1, evidenceKind: "current_named_parent_source_comparison", recordedAt: stamp,
      preparedAt: stamp, pointInTimeOnly: true, preparedFilesOnly: true, preparedFiles: 85, comparison: "changed",
      matchedFiles: 84, changedFiles: 1, unavailableFiles: 0, deploymentReviewComplete: false,
      collectionPermissionIssued: false, candidateModulesImported: false, workerExecuted: false,
      configurationChanged: false, sourceRequests: 0, publicationEnabled: false, scheduleEnabled: false } } },
  { file: "weekly-rehearsal-status-view.tsx", component: "WeeklyRehearsalStatusView", endpoint: "/api/dev/update-rehearsal/status", deadline: 8000,
    visible: /Observed <time/, held: /weekly history could not be verified/, value: { state: "observed", observation: {
      schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: "2026-10-05T07:30:00Z",
      dueAt: "2026-10-05T06:00:00Z", windowKey: "2026-W41", graceMinutes: 60, state: "attention",
      reason: "scheduled_run_missing", coverage: "unknown", totalReceipts: 0, unreadableReceipts: 0,
      pendingReceipts: 0, realScheduleEnabled: false, trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0 } } },
  { file: "correction-review-operation-view.tsx", component: "CorrectionReviewOperationView", endpoint: "/api/dev/correction-review", deadline: 8000,
    visible: /Four invented reports stayed private/, held: /cannot repair or retry/, onMount: true,
    value: { state: "checked", result: correctionReviewExecution() } },
];

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
// Execute the actual component callbacks and parser. Inject only React hooks
// and the shared helper's monotonic clock; no DOM, HTTP or browser is opened.
function harness(entry, clock) {
  const path = new URL(`../src/${entry.file}`, import.meta.url), native = createRequire(path), exports = {};
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  let cursor = 0, effect, cleanup, layout, layoutCleanup; const cells = [];
  const hooks = {
    useState(initial) { const index = cursor++; cells[index] ??= initial; return [cells[index], value => { cells[index] = value; }]; },
    useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index]; },
    useEffect(callback) { effect = callback; },
    useLayoutEffect(callback) { layout = callback; },
  };
  new Function("require", "exports", compiled)(name => name === "react" ? hooks
    : name === "./local-request-deadline.ts" ? { withLocalRequestDeadline: (signal, ms, read, _now, notice) => {
      assert.equal(ms, entry.deadline); return withLocalRequestDeadline(signal, ms, read, clock, notice);
    } } : native(name), exports);
  const render = () => { cursor = 0; return exports[entry.component](); };
  return { markup: () => renderToStaticMarkup(render()), mount() { render(); layoutCleanup = layout?.(); cleanup = effect(); }, unmount() { layoutCleanup?.(); cleanup?.(); },
    buttons() { return nodes(render()).filter(item => item.type === "button").map(item => item.props); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const entry of cases) test(`${entry.component} withholds late or invalid post-parse observations and preserves one pending read`, async () => {
  const original = globalThis.fetch;
  try {
    for (const elapsed of [entry.deadline - 1, entry.deadline, entry.deadline + 1, -1, NaN]) {
      let clock = 0, reads = 0, resolve, owned;
      globalThis.fetch = async (url, options) => {
        reads++; assert.equal(url, entry.endpoint); assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store");
        assert.equal(options.body, undefined); owned = options.signal; return new Promise(done => { resolve = done; });
      };
      const ui = harness(entry, () => clock);
      try {
        ui.mount(); if (!entry.onMount) ui.buttons()[0].onClick();
        ui.buttons()[0].onClick(); assert.equal(reads, 1); assert.equal(ui.buttons()[0].disabled, true);
        // Advance at native body EOF; the unchanged terminal deadline check
        // still covers decoding and parsing. A json-only port is no longer a
        // valid response for the fixed bounded byte reader.
        const response = Response.json(entry.value);
        const acquire = response.body.getReader.bind(response.body);
        response.body.getReader = (...args) => {
          const reader = acquire(...args), read = reader.read.bind(reader);
          reader.read = async () => {
            const result = await read();
            if (result.done) clock = elapsed;
            return result;
          };
          return reader;
        };
        resolve(response); await settle();
        assert.equal(owned.aborted, true); assert.equal(ui.buttons()[0].disabled, false);
        if (elapsed === entry.deadline - 1) assert.match(ui.markup(), entry.visible);
        else { assert.match(ui.markup(), entry.held); assert.doesNotMatch(ui.markup(), entry.visible); }
        if (entry.component === "WeeklyRehearsalStatusView" && elapsed >= entry.deadline)
          assert.equal(ui.buttons().length, 1, "late evidence must not remain exportable");
      } finally { ui.unmount(); }
    }
  } finally { globalThis.fetch = original; }
});

for (const entry of cases) test(`${entry.component} explains the deadline while retaining one pending slot until actual settlement`, async t => {
  let fire, resolve, reads = 0, owned;
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async (_url, options) => { reads++; owned = options.signal; return new Promise(done => { resolve = done; }); });
  const ui = harness(entry, () => 0);
  try {
    ui.mount(); if (!entry.onMount) ui.buttons()[0].onClick();
    fire(); await settle();
    assert.equal(owned.aborted, true); assert.equal(ui.buttons()[0].disabled, true);
    assert.match(ui.markup(), /response deadline elapsed/); assert.match(ui.markup(), /original read is still finishing/);
    assert.doesNotMatch(ui.markup(), entry.visible);
    ui.buttons()[0].onClick(); assert.equal(reads, 1);
    resolve(Response.json(entry.value)); await settle();
    assert.equal(ui.buttons()[0].disabled, false); assert.match(ui.markup(), entry.held);
    assert.doesNotMatch(ui.markup(), entry.visible); assert.doesNotMatch(ui.markup(), /original read is still finishing/);
  } finally { ui.unmount(); }
});

test("unmounted operator reads cannot deliver a deadline notice or a late observation", async t => {
  let fire, resolve;
  t.mock.method(globalThis, "setTimeout", callback => { fire = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "fetch", async () => new Promise(done => { resolve = done; }));
  const entry = cases.at(-1), ui = harness(entry, () => 0);
  ui.mount(); ui.unmount(); fire(); resolve(Response.json(entry.value)); await settle();
  assert.doesNotMatch(ui.markup(), /response deadline elapsed|Four invented reports/);
});

test("correction review refresh removes dated old counts while the next read is pending", async () => {
  const entry = cases.at(-1), original = globalThis.fetch, replies = [];
  globalThis.fetch = async () => new Promise(resolve => replies.push(resolve));
  const ui = harness(entry, () => 0);
  try {
    ui.mount(); replies[0](Response.json(entry.value)); await settle(); assert.match(ui.markup(), entry.visible);
    ui.buttons()[0].onClick(); assert.match(ui.markup(), /Reading the saved result/);
    assert.doesNotMatch(ui.markup(), /Four invented reports|Recorded <time/);
    replies[1](Response.json({ state: "held", reason: "private_test_unavailable" })); await settle();
    assert.match(ui.markup(), entry.held); assert.doesNotMatch(ui.markup(), entry.visible);
  } finally { ui.unmount(); globalThis.fetch = original; }
});
