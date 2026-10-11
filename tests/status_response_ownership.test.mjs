import assert from "node:assert/strict";
import test from "node:test";
import { requestCurrentIssueStatus, currentIssueIdentity } from "../src/current-issue-status.ts";
import { connectedInput } from "./helpers/connected_reader_fixture.mjs";
const identity = currentIssueIdentity(connectedInput().issue);
const payload = { schemaVersion: 1, kind: "current", ...identity };
const encoded = value => new TextEncoder().encode(JSON.stringify(value));

for (const phase of ["subscribe", "remove"]) test(`native current-status stream independently cancels and releases after ${phase} refusal`, async () => {
  const parent = new AbortController(), add = parent.signal.addEventListener.bind(parent.signal), remove = parent.signal.removeEventListener.bind(parent.signal);
  let cancellations = 0;
  const body = new ReadableStream({ start(controller) { controller.enqueue(phase === "subscribe" ? encoded(payload) : new Uint8Array(1025)); }, cancel() { cancellations++; } });
  const response = new Response(body);
  if (phase === "subscribe") parent.signal.addEventListener = (...args) => { add(...args); throw Error("PRIVATE_SUBSCRIPTION_CANARY"); };
  else parent.signal.removeEventListener = (...args) => { remove(...args); throw Error("PRIVATE_REMOVE_CANARY"); };
  await assert.rejects(requestCurrentIssueStatus(identity, parent.signal, async () => response));
  assert.equal(cancellations, 1); assert.equal(body.locked, false);
});

test("successful current-status parsing survives listener retirement failure and releases the native lock", async () => {
  const parent = new AbortController(), remove = parent.signal.removeEventListener.bind(parent.signal);
  parent.signal.removeEventListener = (...args) => { remove(...args); throw Error("PRIVATE_REMOVE_CANARY"); };
  const response = Response.json(payload);
  assert.deepEqual(await requestCurrentIssueStatus(identity, parent.signal, async () => response), payload);
  assert.equal(response.body.locked, false);
});

import { readStatusResponse } from "../src/status-response.ts";
import { connectedStatusIdentity, connectedStatusPayload } from "../src/connected-reader-status.ts";
import { startConnectedReaderWatch } from "../src/connected-reader-watch.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const flush = () => new Promise(resolve => setImmediate(resolve));

test("shared status reader admits exact byte ceiling with split UTF8 and rejects overflow, malformed data and cancellation", async () => {
  const signal = new AbortController().signal, object = { label: "é" };
  const json = encoded(object), remaining = 1024 - json.byteLength;
  const body = new ReadableStream({ start(c) { c.enqueue(json.slice(0, 11)); c.enqueue(json.slice(11)); c.enqueue(new Uint8Array(remaining).fill(32)); c.close(); } });
  assert.deepEqual(await readStatusResponse(new Response(body), signal), object); assert.equal(body.locked, false);
  for (const response of [new Response(" ".repeat(1025)), new Response(new Uint8Array([0xc3,0x28])), new Response("{broken"), new Response("", { status: 503 }),
    new Response("{}", { headers: { "content-length": "1025" } }), new Response("{}", { headers: { "content-length": "invalid" } })]) await assert.rejects(readStatusResponse(response, signal));
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(readStatusResponse(Response.json(object), aborted.signal));
});

test("cancelled native status stream releases promptly without awaiting underlying cancellation acknowledgement", async () => {
  for (const acknowledgement of ["pending", "rejected"]) {
    const abort = new AbortController(); let cancels = 0;
    const body = new ReadableStream({ start() {}, cancel() { cancels++; return acknowledgement === "pending" ? new Promise(() => {}) : Promise.reject(Error("PRIVATE_CANCEL_CANARY")); } });
    const pending = readStatusResponse(new Response(body), abort.signal); await flush(); abort.abort();
    await assert.rejects(pending); assert.equal(cancels, 1); assert.equal(body.locked, false);
  }
});

for (const phase of ["oversize", "pending-body"]) test(`actual connected wrapper terminally withholds ${phase} metadata and cancels the owned native stream`, async t => {
  const snapshot = { ...connectedInput(), generation: 1 }, expected = connectedStatusIdentity(snapshot);
  const listeners = new Map(), intervals = new Map(), timers = new Map(); let status = { kind: "current" }, effect, owned, cancels = 0, reads = 0, token = 0;
  const originalDocument = globalThis.document;
  globalThis.document = { visibilityState: "visible", addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const body = new ReadableStream({ start(controller) { if (phase === "oversize") controller.enqueue(new TextEncoder().encode(JSON.stringify(connectedStatusPayload({ kind: "snapshot", snapshot })) + " ".repeat(2048))); }, cancel() { cancels++; } });
  t.mock.method(globalThis, "fetch", async (url, options) => { reads++; assert.equal(url, "/api/dev/connected-reader"); assert.equal(options.credentials, "omit"); owned = options.signal; return new Response(body); });
  const c = { visible: () => true, now: () => 0, interval: fn => { intervals.set(++token, fn); return token; }, clearInterval: id => intervals.delete(id),
    timeout: fn => { timers.set(++token, fn); return token; }, clearTimeout: id => timers.delete(id) };
  const Component = loadTsx(new URL("../app/connected-preview/CurrentConnectedEdition.tsx", import.meta.url), name => name === "react"
    ? { useState: () => [status, next => { status = next; }], useEffect: callback => { effect = callback; } }
    : name.endsWith("connected-reader-watch") ? { startConnectedReaderWatch: (identity, changed, verify) => startConnectedReaderWatch(identity, changed, verify, c) } : undefined).CurrentConnectedEdition;
  let cleanup;
  try {
    const props = { expected, children: createElement("textarea", { defaultValue: "OLD_CONNECTED_DRAFT_CANARY" }) };
    Component(props); cleanup = effect(); await flush();
    if (phase === "pending-body") { assert.equal(body.locked, true); [...timers.values()][0](); await flush(); }
    assert.equal(status.kind, "unavailable"); assert.equal(owned.aborted, true); assert.equal(cancels, 1); assert.equal(body.locked, false);
    assert.doesNotMatch(renderToStaticMarkup(Component(props)), /OLD_CONNECTED_DRAFT_CANARY|<textarea|PRIVATE_/);
    assert.equal(intervals.size, 0); assert.equal(timers.size, 0); await flush(); assert.equal(reads, 1);
  } finally { cleanup?.(); globalThis.document = originalDocument; }
});

for (const phase of ["status", "declared-size", "already-aborted"]) test(`early ${phase} refusal cancels its unread native response without acquiring a lock`, async () => {
  let cancels = 0;
  const body = new ReadableStream({ start() {}, cancel() { cancels++; } });
  const controller = new AbortController(); if (phase === "already-aborted") controller.abort();
  const response = new Response(body, { status: phase === "status" ? 503 : 200,
    headers: phase === "declared-size" ? { "content-length": "1025" } : undefined });
  await assert.rejects(readStatusResponse(response, controller.signal)); assert.equal(cancels, 1); assert.equal(body.locked, false);
});
