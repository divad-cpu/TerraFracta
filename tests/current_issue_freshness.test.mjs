import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { currentIssueIdentity, currentIssueStatusPayload, interpretCurrentIssueStatus, requestCurrentIssueStatus } from "../src/current-issue-status.ts";
import { startCurrentIssueWatch } from "../src/current-issue-watch.ts";
import { createCurrentIssueStatusHandler } from "../src/server/current-issue-status.ts";
import { createPublicIssueReader } from "../src/server/public-issue-reader.ts";
import { sample } from "./helpers/public_read_rows_fixture.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const decisionFor = candidate => createPublicIssueReader(async () => new TextEncoder().encode(JSON.stringify(candidate)))(sample().requestedRoute);
const route = sample().requestedRoute;
const context = () => ({ params: Promise.resolve({ country: route.jurisdictionSlug, issue: route.issueSlug }) });
const request = (extra = {}) => new Request(`http://127.0.0.1:3000/api/dev/current-issue-status/${route.jurisdictionSlug}/${route.issueSlug}`, {
  headers: { "sec-fetch-site": "same-origin", ...extra.headers }, ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "headers")),
});
function controls() {
  const intervals = new Map(), timeouts = new Map(); let id = 0;
  return { intervals, timeouts, visibleNow: true, elapsed: 0,
    visible() { return this.visibleNow; }, now() { return this.elapsed; },
    interval(fn, ms) { assert.equal(ms, 15000); intervals.set(++id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    timeout(fn, ms) { assert.equal(ms, 3000); timeouts.set(++id, fn); return id; }, clearTimeout(id) { timeouts.delete(id); } };
}
const controlled = c => ({ ...c, visible: () => c.visibleNow, now: () => c.elapsed });
function load(relative, intercept = () => undefined) {
  const file = new URL(relative, import.meta.url), native = createRequire(file), exports = {};
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", compiled)(name => {
    const replacement = intercept(name); if (replacement !== undefined) return replacement;
    if (name.startsWith(".")) {
      const full = new URL(name, file);
      if (full.pathname.endsWith(".tsx") || existsSync(new URL(full.href + ".tsx"))) return load(full.pathname.endsWith(".tsx") ? full.href : full.href + ".tsx", intercept);
      if (existsSync(new URL(full.href + ".ts"))) return native(name + ".ts");
    }
    return native(name);
  }, exports); return exports;
}

test("fresh metadata uses exactly one current materialized read and exposes only canonical identity", async () => {
  let candidate = sample(), calls = 0;
  const read = createPublicIssueReader(async () => { calls++; return new TextEncoder().encode(JSON.stringify(candidate)); });
  const handle = createCurrentIssueStatusHandler(read);
  const first = await handle(request(), context(), "development"), payload = await first.json();
  assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "no-store"); assert.equal(calls, 1);
  assert.deepEqual(Object.keys(payload).sort(), ["schemaVersion", "kind", "issueId", "publicationId", "revision", "jurisdictionSlug", "issueSlug"].sort());
  for (const text of [candidate.publication.snapshot.title, candidate.publication.snapshot.claims[0].assertion, candidate.publication.snapshot.claims[0].evidence[0].url, "registration_id", "requestedRoute"]) assert.ok(!JSON.stringify(payload).includes(text));
  candidate = null; const second = await handle(request(), context(), "development"); assert.equal(second.status, 200); assert.deepEqual(await second.json(), { schemaVersion: 1, kind: "absent" }); assert.equal(calls, 2);
});
test("production, method, origin, query, path, context and cancellation refusals precede provider reads", async () => {
  let reads = 0; const handle = createCurrentIssueStatusHandler(async () => { reads++; throw new Error("PRIVATE_CANARY"); });
  const poison = new Proxy({}, { get() { throw new Error("PRIVATE_CANARY"); } });
  assert.equal((await handle(poison, poison, "production")).status, 404);
  for (const bad of [request({ method: "POST" }), request({ headers: { "sec-fetch-site": "cross-site" } }), request({ headers: { origin: "http://evil.invalid" } }), new Request(request().url + "?sql=PRIVATE_CANARY"), new Request(request().url + "/extra", { headers: { "sec-fetch-site": "same-origin" } })]) assert.ok((await handle(bad, context(), "development")).status >= 400);
  assert.equal((await handle(request(), { params: Promise.resolve({ country: route.jurisdictionSlug, issue: route.issueSlug, sql: "PRIVATE_CANARY" }) }, "development")).status, 404);
  const aborted = new AbortController(); aborted.abort(); assert.equal((await handle(request({ signal: aborted.signal }), context(), "development")).status, 503); assert.equal(reads, 0);
});
test("rights withdrawal, malformed projections, cross-route replies and private errors never disclose the old issue", async () => {
  const good = await decisionFor(sample()), withdrawn = sample(); withdrawn.sources[0].registration.allow_public_derived = false;
  for (const read of [() => decisionFor(withdrawn), async () => ({ ...good, issue: { ...good.issue, privateCanary: "PRIVATE_CANARY" } }), async () => ({ ...good, issue: { ...good.issue, issueSlug: "wrong-issue" } }), async () => { throw new Error("PRIVATE_CANARY"); }]) {
    const response = await createCurrentIssueStatusHandler(read)(request(), context(), "development"); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { schemaVersion: 1, kind: "unavailable" });
  }
});
test("cancellation during awaited route params prevents the reader seam from starting", async () => {
  let settle, reads = 0; const controller = new AbortController();
  const handle = createCurrentIssueStatusHandler(async () => { reads++; return { status: 404, cacheControl: "no-store" }; });
  const pending = handle(request({ signal: controller.signal }), { params: new Promise(resolve => { settle = resolve; }) }, "development");
  controller.abort(); settle({ country: route.jurisdictionSlug, issue: route.issueSlug });
  assert.equal((await pending).status, 503); assert.equal(reads, 0);
});
test("exact status parser distinguishes successor, absence and invalid substitution without private payload", async () => {
  const good = await decisionFor(sample()), expected = currentIssueIdentity(good.issue), payload = currentIssueStatusPayload(good);
  assert.deepEqual(interpretCurrentIssueStatus(payload, expected), { kind: "current" });
  assert.deepEqual(interpretCurrentIssueStatus({ ...payload, publicationId: randomUUID(), revision: 2 }, expected), { kind: "changed" });
  assert.deepEqual(interpretCurrentIssueStatus({ schemaVersion: 1, kind: "absent" }, expected), { kind: "absent" });
  for (const changed of [{ issueId: randomUUID() }, { jurisdictionSlug: "different-place" }, { publicationId: randomUUID() }, { revision: 2 }, { revision: 0 }, { claims: "PRIVATE_CANARY" }]) assert.deepEqual(interpretCurrentIssueStatus({ ...payload, ...changed }, expected), { kind: "unavailable" });
});
test("watch skips hidden views, coalesces overlap and owns its aborted read after stop", async () => {
  const c = controls(), expected = currentIssueIdentity((await decisionFor(sample())).issue), updates = []; let reads = 0, settle, signal;
  c.visibleNow = false;
  const watch = startCurrentIssueWatch(expected, value => updates.push(value), async (_expected, selected) => { reads++; signal = selected; return new Promise(resolve => { settle = resolve; }); }, controlled(c));
  await watch.check(); assert.equal(reads, 0); c.visibleNow = true;
  const pending = watch.check(); await watch.check(); assert.equal(reads, 1);
  watch.stop(); assert.equal(signal.aborted, true); assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  settle({ schemaVersion: 1, kind: "current", ...expected }); await pending; assert.deepEqual(updates, []);
});
test("changed, absent, held and malformed statuses terminally withhold an open edition", async () => {
  const expected = currentIssueIdentity((await decisionFor(sample())).issue);
  for (const payload of [{ schemaVersion: 1, kind: "current", ...expected, publicationId: randomUUID(), revision: 2 }, { schemaVersion: 1, kind: "absent" }, { schemaVersion: 1, kind: "unavailable" }, { privateCanary: "PRIVATE_CANARY" }]) {
    const c = controls(), updates = []; let reads = 0;
    const watch = startCurrentIssueWatch(expected, value => updates.push(value), async () => { reads++; return payload; }, controlled(c));
    await flush(); await watch.check(); assert.equal(reads, 1); assert.equal(updates.length, 1); assert.equal(c.intervals.size, 0); watch.stop();
  }
});
test("deadline and invalid or regressed monotonic clocks withhold once; late matching replies cannot unmask", async () => {
  const expected = currentIssueIdentity((await decisionFor(sample())).issue);
  for (const finish of [3000, -1, NaN, Infinity]) {
    const c = controls(), updates = []; let settle, signal;
    const watch = startCurrentIssueWatch(expected, value => updates.push(value), async (_expected, selected) => { signal = selected; return new Promise(resolve => { settle = resolve; }); }, controlled(c));
    c.elapsed = finish; settle({ schemaVersion: 1, kind: "current", ...expected }); await flush();
    assert.deepEqual(updates, [{ kind: "unavailable" }]); assert.equal(signal.aborted, true); await watch.check(); assert.equal(updates.length, 1); watch.stop();
  }
  const c = controls(), updates = []; let settle;
  const watch = startCurrentIssueWatch(expected, value => updates.push(value), () => new Promise(resolve => { settle = resolve; }), controlled(c));
  [...c.timeouts.values()][0](); settle({ schemaVersion: 1, kind: "current", ...expected }); await flush(); assert.deepEqual(updates, [{ kind: "unavailable" }]); watch.stop();
});
test("client status request uses a fixed route, omitted credentials, no cache and a bounded closed reply", async () => {
  const expected = currentIssueIdentity((await decisionFor(sample())).issue), controller = new AbortController(), calls = [];
  const send = async (url, options) => { calls.push({ url, options }); return Response.json({ schemaVersion: 1, kind: "current", ...expected }); };
  assert.deepEqual(await requestCurrentIssueStatus(expected, controller.signal, send), { schemaVersion: 1, kind: "current", ...expected });
  assert.equal(calls[0].url, `/api/dev/current-issue-status/${route.jurisdictionSlug}/${route.issueSlug}`); assert.equal(calls[0].options.cache, "no-store"); assert.equal(calls[0].options.credentials, "omit");
  for (const response of [new Response("x".repeat(1025)), new Response("", { status: 503 }), new Response(new Uint8Array([0xff])), new Response("[]", { headers: { "content-length": "2048" } })]) await assert.rejects(requestCurrentIssueStatus(expected, controller.signal, async () => response));
  controller.abort(); await assert.rejects(requestCurrentIssueStatus(expected, controller.signal, () => assert.fail("aborted fetch")));
});
test("an aborted status body read cancels its owned stream even when the fake transport ignores abort", async () => {
  const expected = currentIssueIdentity((await decisionFor(sample())).issue), controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } }));
  const read = requestCurrentIssueStatus(expected, controller.signal, async () => response);
  await flush(); controller.abort();
  const result = await Promise.race([read.then(() => "resolved", () => "rejected"), new Promise(resolve => setTimeout(() => resolve("stalled"), 50))]);
  assert.equal(result, "rejected"); assert.equal(cancelled, true);
});
test("actual current wrapper removes every child and cleans visibility ownership after a held result", async () => {
  const expected = currentIssueIdentity((await decisionFor(sample())).issue), c = controls(), listeners = new Map(); let state = { kind: "current" }, effect, cleanup, payload = { schemaVersion: 1, kind: "current", ...expected };
  const originalDocument = globalThis.document;
  globalThis.document = { visibilityState: "visible", addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); } };
  try {
    const wrapper = load("../app/reader-preview/CurrentIssueEdition.tsx", name => name === "react" ? { ...React, useState: () => [state, value => { state = value; }], useEffect: fn => { effect = fn; } } : name.endsWith("current-issue-watch.ts") ? { startCurrentIssueWatch: (identity, changed, read) => startCurrentIssueWatch(identity, changed, read, controlled(c)) } : name.endsWith("current-issue-status.ts") ? { requestCurrentIssueStatus: async () => payload } : undefined).CurrentIssueEdition;
    const props = { expected, latestHref: "/reader-preview/imaginary-place/sample-housing-measure/issue", children: createElement("div", null, "VISIBLE_CLAIM_CANARY", createElement("textarea", { defaultValue: "UNSENT_DRAFT_CANARY" }), createElement("a", { href: "https://example.org/private-source-canary" }, "SOURCE_CANARY")) };
    assert.ok(renderToStaticMarkup(wrapper(props)).includes("UNSENT_DRAFT_CANARY")); cleanup = effect(); await flush();
    payload = { schemaVersion: 1, kind: "absent" }; [...c.intervals.values()][0](); await flush();
    const html = renderToStaticMarkup(wrapper(props)); assert.ok(html.includes("no longer available"));
    for (const value of ["VISIBLE_CLAIM_CANARY", "UNSENT_DRAFT_CANARY", "SOURCE_CANARY", "textarea"]) assert.ok(!html.includes(value));
    payload = { schemaVersion: 1, kind: "current", ...expected }; listeners.get("visibilitychange")(); await flush(); assert.equal(state.kind, "absent");
    cleanup(); assert.equal(listeners.size, 0); assert.equal(c.intervals.size, 0); assert.equal(c.timeouts.size, 0);
  } finally { globalThis.document = originalDocument; }
});
