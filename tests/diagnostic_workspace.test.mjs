import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";
import { buildDiagnosticReport, diagnosticSelection, selectDiagnosticEvents, diagnosticPageHref } from "../src/diagnostic-report.ts";
import { createDevelopmentDiagnosticReader } from "../src/server/diagnostic-reader.ts";
import { createDiagnosticDownload } from "../src/server/diagnostic-download.ts";
import { ErrorLogStore } from "../src/server/error-log-store.ts";
import { exportErrorLog } from "../scripts/export_error_log.mjs";

const clock = new Date("2026-10-04T15:30:00.000Z");
const event = (code = "server_route", time = clock) => makeDiagnosticEvent(code, randomUUID(), time);
const snapshot = (events, extra = {}) => ({ events, unreadable: 0, filesObserved: events.length, stable: true, locked: false, ...extra });
const report = events => buildDiagnosticReport(snapshot(events), clock);
const get = (extra = {}) => new Request("http://127.0.0.1:3000/api/dev/error-log/export", { headers: { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin", ...extra.headers }, ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "headers")) });

function load(relative, substitutions = {}) {
  const source = new URL(relative, import.meta.url), native = createRequire(source), exports = {};
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = name => {
    if (name in substitutions) return substitutions[name];
    if (name.startsWith(".")) {
      const full = new URL(name, source);
      if (full.pathname.endsWith(".tsx") || existsSync(new URL(full.href + ".tsx"))) return load(full.pathname.endsWith(".tsx") ? full.href : full.href + ".tsx", substitutions);
    }
    return native(name);
  };
  new Function("require", "exports", compiled)(require, exports); return exports;
}
const render = (result, selection = diagnosticSelection({})) => renderToStaticMarkup(createElement(load("../src/diagnostic-workspace-view.tsx").DiagnosticWorkspace, { result, selection }));

test("closed report groups repeats without claiming health, hides corrupt input and preserves export shape", () => {
  const a = event("server_route", new Date("2026-10-04T13:00:00.000Z")), b = event("server_route"), c = event("page_render");
  const value = report([b, c, a]), selected = selectDiagnosticEvents(value, diagnosticSelection({}));
  assert.equal(selected.total, 3); assert.equal(selected.groups[0].count, 2); assert.equal(selected.groups[0].code, "server_route");
  assert.equal(selected.groups[0].firstAt, a.occurredAt); assert.equal(value.counts.page_render, 1);
  assert.equal(value.captureCompleteness, "unknown"); assert.equal(value.buildBinding, "not_bound_to_a_deployed_build");
  assert.equal(buildDiagnosticReport(null, clock).inspectionComplete, false);
  for (const invalid of [snapshot([a, a]), snapshot([a], { filesObserved: 2 }), snapshot([{ ...a, message: "PRIVATE_CANARY" }]), { ...snapshot([]), path: "PRIVATE_CANARY" }]) assert.throws(() => buildDiagnosticReport(invalid, clock));
});
test("closed selectors reject repeated, private, unsupported, null and excessive input", () => {
  const ref = randomUUID();
  assert.deepEqual(diagnosticSelection({ ref, page: "2", code: "server_route", origin: "server" }), { reference: ref, page: 2, code: "server_route", origin: "server" });
  for (const invalid of [null, [], { code: ["server_route"] }, { code: null }, { origin: null }, { ref: null }, { page: null }, { directory: "PRIVATE_CANARY" }, { ref: "<script>PRIVATE_CANARY</script>" }, { page: "01" }, { page: "42" }]) assert.equal(diagnosticSelection(invalid), null);
});
test("pagination retains exact filters and reference, clamps page after changed result, and never mutates reports", () => {
  const events = Array.from({ length: 51 }, (_, i) => event("server_route", new Date(clock.valueOf() + i * 1_000))), value = report(events);
  const before = JSON.stringify(value), selection = diagnosticSelection({ code: "server_route", page: "2" });
  const middle = selectDiagnosticEvents(value, selection); assert.equal(middle.events.length, 25); assert.equal(middle.pages, 3); assert.equal(middle.page, 2);
  assert.equal(diagnosticPageHref(selection, 3), "/diagnostics-preview?code=server_route&page=3");
  const exact = selectDiagnosticEvents(value, { ...selection, reference: events[0].eventId, page: 40 });
  assert.equal(exact.total, 1); assert.equal(exact.page, 1); assert.deepEqual(exact.events, [events[0]]);
  assert.equal(JSON.stringify(value), before);
});
test("actual private archive reaches the reader, HTML, JSON download and CLI export without modifying original events", async () => {
  const parent = await mkdtemp("/tmp/terrafracta-diagnostic-workspace-"), directory = join(parent, "log"), store = new ErrorLogStore(directory), a = event("server_route"), b = event("page_render");
  assert.equal(await store.append(a), "saved"); assert.equal(await store.append(b), "saved");
  const original = await readFile(join(directory, a.eventId + ".json"));
  const read = createDevelopmentDiagnosticReader(() => store.inspect(), () => "development", () => clock);
  const result = await read(); assert.equal(result.kind, "available");
  const html = render(result); assert.ok(html.includes(a.eventId)); assert.ok(html.includes("Recorded archive inspected")); assert.ok(html.includes('href="/api/dev/error-log/export"')); assert.ok(html.includes("not establish that the platform is healthy"));
  const response = await createDiagnosticDownload(read)(get(), "development"); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.ok(response.headers.get("content-disposition").includes("attachment"));
  const bundle = await response.json(); assert.deepEqual(bundle, result.report);
  const output = join(parent, "export.json"); await exportErrorLog(directory, output);
  const cli = JSON.parse(await readFile(output, "utf8")); assert.deepEqual(Object.keys(cli).sort(), Object.keys(bundle).sort()); assert.deepEqual(cli.events, bundle.events);
  assert.deepEqual(await readFile(join(directory, a.eventId + ".json")), original);
});
test("unknown private entries, active lock and quota warning stay explicit and leak no unknown bytes", async () => {
  const parent = await mkdtemp("/tmp/terrafracta-diagnostic-partial-"), directory = join(parent, "log"); await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, "unknown.json"), '{"secret":"PRIVATE_CANARY"}', { mode: 0o600 }); await mkdir(join(directory, ".write-lock"), { mode: 0o700 });
  const inspected = await new ErrorLogStore(directory).inspect(), value = buildDiagnosticReport(inspected, clock), html = render({ kind: "available", report: value });
  assert.equal(value.unreadableFiles, 1); assert.equal(value.inspectionComplete, false); assert.equal(value.locked, true);
  assert.ok(html.includes("Inspection is incomplete")); assert.ok(html.includes("write lock was observed")); assert.ok(!html.includes("PRIVATE_CANARY"));
  const full = buildDiagnosticReport(snapshot([], { unreadable: 1000, filesObserved: 1000 }), clock);
  assert.ok(render({ kind: "available", report: full }).includes("New reports can be refused"));
});
test("missing, empty, invalid-filter, unavailable and busy views show recovery without an error-free verdict", () => {
  assert.ok(render({ kind: "available", report: buildDiagnosticReport(null, clock) }).includes("No diagnostic archive found"));
  assert.ok(render({ kind: "available", report: report([]) }).includes("No matching recorded event"));
  assert.ok(render(null, null).includes("archive was not read"));
  for (const kind of ["unavailable", "busy"]) { const html = render({ kind }); assert.ok(html.includes("No earlier records")); assert.ok(!html.includes('href="/api/dev/error-log/export"')); }
});
test("production page refusal happens before observing props or the archive; invalid dev filters never inspect", async () => {
  const prior = process.env.NODE_ENV; let reads = 0;
  try {
    const page = load("../app/diagnostics-preview/page.tsx", { "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } }, "../../src/server/diagnostic-reader.ts": { readDevelopmentDiagnostics() { reads++; return { kind: "available", report: report([]) }; } } }).default;
    process.env.NODE_ENV = "production";
    await assert.rejects(page(Object.defineProperty({}, "searchParams", { get() { throw new Error("PRIVATE_CANARY"); } })), /NOT_FOUND/); assert.equal(reads, 0);
    process.env.NODE_ENV = "development";
    const invalid = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ code: ["server_route"] }) })); assert.ok(invalid.includes("Check the filters")); assert.equal(reads, 0);
    const valid = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) })); assert.ok(valid.includes("Recorded archive inspected")); assert.equal(reads, 1);
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});
test("reader refuses production, opaque invalid/failing input and owns one unfinished disk read after deadline", async () => {
  let calls = 0, settle;
  const read = createDevelopmentDiagnosticReader(() => { calls++; return new Promise(resolve => { settle = resolve; }); }, () => "development", () => clock);
  const first = read(); await Promise.resolve(); assert.equal((await read()).kind, "busy");
  assert.equal((await first).kind, "unavailable"); assert.equal((await read()).kind, "busy"); assert.equal(calls, 1);
  settle(snapshot([])); await new Promise(resolve => setImmediate(resolve));
  const next = read(); await Promise.resolve(); settle(snapshot([])); assert.equal((await next).kind, "available"); assert.equal(calls, 2);
  assert.equal((await createDevelopmentDiagnosticReader(() => { assert.fail("Production read"); }, () => "production")()).kind, "disabled");
  for (const inspect of [() => { throw new Error("PRIVATE_CANARY"); }, async () => snapshot([{ message: "PRIVATE_CANARY" }])]) assert.deepEqual(await createDevelopmentDiagnosticReader(inspect, () => "development")(), { kind: "unavailable" });
});
test("download production/origin/query/method/abort refusals precede reads and contain private details", async () => {
  let calls = 0; const download = createDiagnosticDownload(async () => { calls++; return { kind: "available", report: report([]) }; });
  assert.equal((await download(new Proxy({}, { get() { throw new Error("PRIVATE_CANARY"); } }), "production")).status, 404);
  for (const value of [get({ headers: { "sec-fetch-site": "cross-site" } }), get({ headers: { origin: "http://evil.invalid" } }), new Request("http://127.0.0.1:3000/api/dev/error-log/export?directory=PRIVATE_CANARY"), get({ method: "POST" })]) { const response = await download(value, "development"); assert.ok([403, 405].includes(response.status)); assert.equal(await response.text(), ""); }
  const controller = new AbortController(); controller.abort(); assert.equal((await download(get({ signal: controller.signal }), "development")).status, 400); assert.equal(calls, 0);
  const opaque = await createDiagnosticDownload(async () => { throw new Error("PRIVATE_CANARY"); })(get(), "development"); assert.equal(opaque.status, 503); assert.equal(await opaque.text(), "");
});
test("download prevents parallel queueing and limits per-minute reads without changing the archive", async () => {
  let time = 0, settle, reads = 0;
  const download = createDiagnosticDownload(() => { reads++; return new Promise(resolve => { settle = resolve; }); }, () => time);
  const pending = download(get(), "development"); await Promise.resolve(); assert.equal((await download(get(), "development")).status, 429); assert.equal(reads, 1);
  settle({ kind: "available", report: report([]) }); assert.equal((await pending).status, 200);
  const limited = createDiagnosticDownload(async () => ({ kind: "available", report: report([]) }), () => time);
  for (let i = 0; i < 30; i++) assert.equal((await limited(get(), "development")).status, 200);
  assert.equal((await limited(get(), "development")).status, 429); time = 60_000; assert.equal((await limited(get(), "development")).status, 200);
});
test("diagnostic reader rechecks monotonic expiry after delayed event-loop settlement", async () => {
  for (const finish of [1500, -1, NaN, Infinity]) {
    let time = 0;
    const read = createDevelopmentDiagnosticReader(async () => { time = finish; return snapshot([]); }, () => "development", () => clock, () => time);
    assert.deepEqual(await read(), { kind: "unavailable" });
  }
  assert.deepEqual(await createDevelopmentDiagnosticReader(() => { assert.fail("Invalid clock read"); }, () => "development", () => clock, () => NaN)(), { kind: "unavailable" });
});
test("web download rejects a typed reader's extra private fields, inconsistent counts and forged catalogue", async () => {
  const good = report([event()]);
  for (const invalid of [{ ...good, privateDetail: "PRIVATE_CANARY" }, { ...good, counts: { ...good.counts, server_route: 12 } },
    { ...good, locations: { ...good.locations, server_route: { origin: "server", location: "PRIVATE_CANARY" } } }, { ...good, events: [{ ...good.events[0], stack: "PRIVATE_CANARY" }] }]) {
    const response = await createDiagnosticDownload(async () => ({ kind: "available", report: invalid }))(get(), "development");
    assert.equal(response.status, 503); assert.equal(await response.text(), "");
  }
});

test("diagnostic reader contains a thrown initial clock before archive dispatch and permits a later observation", async () => {
  let failed = true, calls = 0;
  const read = createDevelopmentDiagnosticReader(async () => { calls++; return snapshot([]); }, () => "development", () => clock,
    () => { if (failed) throw new Error("PRIVATE_CLOCK_SETUP"); return 0; });
  assert.deepEqual(await read(), { kind: "unavailable" }); assert.equal(calls, 0);
  failed = false; assert.equal((await read()).kind, "available"); assert.equal(calls, 1);
});

test("diagnostic reader installs its deadline before inspection and releases a failed unused slot", async t => {
  let calls = 0;
  const read = createDevelopmentDiagnosticReader(async () => { calls++; return snapshot([]); }, () => "development", () => clock, () => 0);
  t.mock.method(globalThis, "setTimeout", () => { throw new Error("PRIVATE_TIMER_SETUP"); });
  assert.deepEqual(await read(), { kind: "unavailable" }); assert.equal(calls, 0);
  t.mock.restoreAll(); assert.equal((await read()).kind, "available"); assert.equal(calls, 1);
});
