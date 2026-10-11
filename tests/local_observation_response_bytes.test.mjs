import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { correctionReviewExecution, supervisedCorrectionReviewExecution } from "./helpers/correction_review_execution.mjs";
const stamp = "2026-10-03T14:36:03.626268+00:00";
const prep = JSON.parse(readFileSync(new URL('../fixtures/local_private_attempt_readiness_snapshot.json', import.meta.url), 'utf8'));
const variants = [
    ["preparation", "current-private-preparation-view", "CurrentPrivatePreparationView", "source-readiness", {}, { state: "observed", observation: { ...prep, evidenceKind: "current_local_preparation_observation", recordedAt: stamp, pointInTimeOnly: true } }, /Observed <time/],
    ["parent", "current-parent-source-view", "CurrentParentSourceView", "parent-source", {}, { state: "observed", observation: { schemaVersion: 1, evidenceKind: "current_named_parent_source_comparison", recordedAt: stamp, preparedAt: "2026-10-03T13:40:22.517416+00:00", pointInTimeOnly: true, preparedFilesOnly: true, preparedFiles: 85, comparison: "changed", matchedFiles: 84, changedFiles: 1, unavailableFiles: 0, deploymentReviewComplete: false, collectionPermissionIssued: false, candidateModulesImported: false, workerExecuted: false, configurationChanged: false, sourceRequests: 0, publicationEnabled: false, scheduleEnabled: false } }, /84 matched, 1 changed/],
    ["copy", "current-copy-scope-view", "CurrentCopyScopeView", "copy-scope", {}, { state: "observed", observation: { schemaVersion: 1, evidenceKind: "current_local_copy_scope_observation", recordedAt: stamp, pointInTimeOnly: true, state: "held", backupExclusion: "observed", syncSetup: "present", otherCopies: "owner_context_pending", allCopyPathsVerified: false, credentialFilesRead: false, rawBodiesRead: false, configurationChanged: false, sourceRequests: 0, collectionPermissionIssued: false, publicationEnabled: false } }, /A configured exclusion matched/],
    ["weekly", "weekly-rehearsal-status-view", "WeeklyRehearsalStatusView", "update-rehearsal/status", {}, { state: "observed", observation: { schemaVersion: 1, evidenceKind: "current_local_fictional_weekly_status", observedAt: stamp, dueAt: "2026-09-28T06:00:00Z", windowKey: "2026-W40", graceMinutes: 60, state: "attention", reason: "run_not_completed", coverage: "unknown", totalReceipts: 8, unreadableReceipts: 0, pendingReceipts: 0, realScheduleEnabled: false, trustedRunLedger: false, sourceRequests: 0, publicationEnabled: false, alertsSent: 0 } }, /8 saved receipts/],
    ["review", "correction-review-operation-view", "CorrectionReviewOperationView", "correction-review", { supervised: false }, { state: "checked", result: correctionReviewExecution() }, /Four invented reports/],
    ["supervised", "correction-review-operation-view", "CorrectionReviewOperationView", "supervised-correction-review", { supervised: true }, { state: "checked", result: supervisedCorrectionReviewExecution() }, /worker had finished/],
];
const turn = () => new Promise(resolve => setImmediate(resolve));
function nodes(v) { if (Array.isArray(v))
    return v.flatMap(nodes); if (!v || typeof v !== "object")
    return []; return [v, ...nodes(v.props?.children)]; }
function harness(file, component, props) {
    const path = new URL(`../src/${file}.tsx`, import.meta.url), native = createRequire(path), exports = {}, cells = [];
    let cursor = 0, effect, cleanup;
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const hooks = { useState(x) { const i = cursor++; if (!(i in cells))
            cells[i] = x; return [cells[i], v => { cells[i] = v; }]; }, useRef(x) { const i = cursor++; if (!(i in cells))
            cells[i] = { current: x }; return cells[i]; }, useEffect(f) { effect = f; } };
    new Function("require", "exports", compiled)(name => name === "react" ? hooks : name === "./client-error-diagnostics.ts" ? { observeClientError() { assert.fail("Observation byte refusal emitted a diagnostic"); } } : native(name), exports);
    const render = () => { cursor = 0; return exports[component](props); };
    return { markup: () => renderToStaticMarkup(render()), mount() { render(); cleanup = effect(); }, unmount() { cleanup?.(); }, buttons() { return nodes(render()).filter(n => n.type === "button").map(n => n.props); } };
}
for (const [label, file, component, endpoint, props, value, visible] of variants) {
    for (const kind of ["oversized", "overdeclared", "refusal", "healthy"])
        test(`${label} actual view ${kind} response owns bounded bytes`, async (t) => {
            const raw = JSON.stringify(value);
            let response, cancels = 0, calls = 0;
            if (kind === "refusal")
                response = new Response(new ReadableStream({ cancel() { cancels++; } }), { status: 503 });
            else if (kind === "oversized")
                response = new Response(' '.repeat(16385) + raw);
            else if (kind === "overdeclared")
                response = new Response(raw, { headers: { "content-length": "16385" } });
            else
                response = new Response(raw + ' '.repeat(16384 - new TextEncoder().encode(raw).byteLength));
            t.mock.method(globalThis, "fetch", async (url, options) => { calls++; assert.equal(url, `/api/dev/${endpoint}`); assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store"); assert.equal(options.body, undefined); return response; });
            const ui = harness(file, component, props);
            t.after(() => ui.unmount());
            ui.mount();
            if (!label.includes("review") && label !== "supervised")
                ui.buttons()[0].onClick();
            await turn();
            assert.equal(calls, 1);
            if (kind === "healthy") {
                assert.match(ui.markup(), visible);
                assert.equal(response.body.locked, false);
            }
            else {
                assert.doesNotMatch(ui.markup(), visible);
                assert.match(ui.markup(), /unavailable|could not be verified/);
                if (label === "weekly")
                    assert.equal(ui.buttons().length, 1);
                assert.equal(response.body.locked, false);
                if (kind === "refusal")
                    assert.equal(cancels, 1);
            }
            ui.buttons()[0].onClick();
            assert.equal(calls, 2);
            await turn(); // Separate explicit read; no automatic retry.
        });
}
