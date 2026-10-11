import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as files from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { buildDiagnosticReport } from "../src/diagnostic-report.ts";

function faultStore(collaborators) {
  const file = new URL("../src/server/error-log-store.ts", import.meta.url), native = createRequire(file), exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", code)(name => name === "node:fs/promises" ? { ...files, ...collaborators } : native(name), exports);
  return exports.ErrorLogStore;
}
async function scratch(t) {
  const parent = await files.mkdtemp(join(tmpdir(), "tf-diagnostic-close-test-"));
  t.after(() => files.rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "archive"), store = new ErrorLogStore(directory);
  const event = makeDiagnosticEvent("server_route", randomUUID(), new Date("2026-10-01T12:00:00Z"));
  assert.equal(await store.append(event), "saved"); return { parent, directory, store, event };
}
for (const mutation of ["contents", "replacement"]) {
  test(`a diagnostic ${mutation} during final namespace observation cannot remain a complete report`, async (t) => {
    const { parent, directory, event } = await scratch(t), path = join(directory, `${event.eventId}.json`);
    const original = await files.readFile(path), preserved = join(parent, "preserved-original.json");
    let reads = 0, changed = false;
    const FaultStore = faultStore({ async readdir(...args) {
      const names = await files.readdir(...args);
      if (++reads === 2) {
        if (mutation === "contents") await files.writeFile(path, "private-canary-invalid");
        else { await files.rename(path, preserved); await files.writeFile(path, original, { mode: 0o600 }); }
        changed = true;
      }
      return names;
    } });
    const inspected = await new FaultStore(directory).inspect();
    assert.equal(changed, true); assert.deepEqual(inspected.events, []);
    assert.equal(inspected.unreadable, 1); assert.equal(inspected.stable, false);
    const report = buildDiagnosticReport(inspected, new Date("2026-10-01T12:01:00Z"));
    assert.equal(report.inspectionComplete, false); assert.equal(report.captureCompleteness, "unknown");
    assert.equal(JSON.stringify(report).includes("private-canary"), false);
    if (mutation === "contents") assert.equal(await files.readFile(path, "utf8"), "private-canary-invalid");
    else assert.deepEqual(await files.readFile(preserved), original);
  });
}
test("an intact diagnostic remains readable when a different final file changes", async (t) => {
  const { directory, store, event } = await scratch(t);
  const other = makeDiagnosticEvent("update_worker", randomUUID(), new Date("2026-10-01T12:00:01Z"));
  assert.equal(await store.append(other), "saved"); let reads = 0;
  const FaultStore = faultStore({ async readdir(...args) {
    const names = await files.readdir(...args);
    if (++reads === 2) await files.writeFile(join(directory, `${event.eventId}.json`), "private-canary-corrupt");
    return names;
  } });
  const inspected = await new FaultStore(directory).inspect();
  assert.deepEqual(inspected.events, [other]); assert.equal(inspected.unreadable, 1);
  assert.equal(inspected.filesObserved, 2); assert.equal(inspected.stable, false);
  assert.equal(buildDiagnosticReport(inspected).inspectionComplete, false);
});
test("unchanged diagnostics retain complete inspection with unknown total capture coverage", async (t) => {
  const { store, event } = await scratch(t), inspected = await store.inspect(), report = buildDiagnosticReport(inspected);
  assert.deepEqual(inspected.events, [event]); assert.equal(inspected.unreadable, 0); assert.equal(inspected.stable, true);
  assert.equal(report.inspectionComplete, true); assert.equal(report.captureCompleteness, "unknown");
});
test("an existing crash-held diagnostic lock still prevents a complete inspection", async (t) => {
  const { directory, store, event } = await scratch(t); await files.mkdir(join(directory, ".write-lock"), { mode: 0o700 });
  const inspected = await store.inspect(); assert.equal(inspected.locked, true); assert.deepEqual(inspected.events, [event]);
  assert.equal(buildDiagnosticReport(inspected).inspectionComplete, false);
  assert.equal((await files.lstat(join(directory, ".write-lock"))).isDirectory(), true);
});
