import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { buildDiagnosticReport } from "../src/diagnostic-report.ts";
import { makeDiagnosticEvent } from "../src/error-diagnostics.ts";

const navigation = createRequire(import.meta.url)("next/navigation");
const NOT_FOUND = Symbol("expected production not-found boundary");
const clock = new Date("2026-10-04T15:30:00.000Z");
const eventId = "12345678-1234-4123-8123-123456789abc";
const report = buildDiagnosticReport({ events: [makeDiagnosticEvent("server_route", eventId, clock)], unreadable: 0, filesObserved: 1, stable: true, locked: false }, clock);
function harness(env = "development") {
  let reads = 0;
  const Page = loadTsx(new URL("../app/diagnostics-preview/page.tsx", import.meta.url), name => {
    if (name === "next/navigation") return { ...navigation, notFound() { throw NOT_FOUND; } };
    if (name === "../../src/server/diagnostic-reader.ts") return { async readDevelopmentDiagnostics() { reads++; return { kind: "available", report }; } };
    return undefined;
  }, { env: { NODE_ENV: env } }).default;
  return { Page, get reads() { return reads; }, render: async searchParams => renderToStaticMarkup(await Page({ searchParams })) };
}
function withheld(html, h) {
  assert.match(html, /Check the filters/);
  assert.match(html, /the archive was not read/);
  assert.match(html, /Open a saved private error export/);
  assert.match(html, /No saved error export is selected/);
  assert.match(html, /href="\/diagnostics-preview"/);
  assert.doesNotMatch(html, new RegExp(`PRIVATE_CANARY|${eventId}|Recorded archive inspected|Download current archive as JSON`));
  assert.equal(h.reads, 0);
}

test("rejected diagnostic query retains filter recovery and local-file inspection without reading the archive", async () => {
  for (const error of [Error("PRIVATE_CANARY"), "PRIVATE_CANARY", null]) {
    const h = harness(); withheld(await h.render(Promise.reject(error)), h);
  }
});

test("throwing or rejected diagnostic query thenables are observed once and disclose no failed-port detail", async () => {
  for (const form of ["getter", "reject"]) {
    const h = harness(); let observations = 0;
    const query = form === "getter" ? { get then() { observations++; throw Error("PRIVATE_CANARY"); } }
      : { then(resolve, reject) { observations++; reject(Error("PRIVATE_CANARY")); } };
    withheld(await h.render(query), h); assert.equal(observations, 1);
  }
});

test("successful diagnostic queries preserve exact filters and one read without a second then assimilation", async () => {
  for (const selectors of [{}, { code: "server_route", origin: "server", ref: eventId, page: "2" }]) {
    const h = harness(), before = JSON.stringify(selectors);
    let observations = 0;
    Object.defineProperty(selectors, "then", { get() { observations++; if (observations === 1) return undefined; throw Error("PRIVATE_CANARY"); } });
    const html = await h.render(selectors);
    assert.equal(observations, 1); assert.equal(h.reads, 1); assert.equal(JSON.stringify(selectors), before);
    assert.match(html, /Recorded archive inspected/); assert.ok(html.includes(eventId));
    assert.match(html, /Open a saved private error export/); assert.doesNotMatch(html, /PRIVATE_CANARY/);
    if (selectors.code) { assert.match(html, /value="server_route" selected=""/); assert.match(html, /value="server" selected=""/); }
  }
});

test("resolved invalid diagnostic selectors keep the existing refusal and independent local-file controls", async () => {
  for (const query of [null, [], { code: ["server_route"] }, { code: "unsupported" }, { extra: "PRIVATE_CANARY" }]) {
    const h = harness(); withheld(await h.render(Promise.resolve(query)), h);
  }
});

test("production diagnostic refusal precedes query observation and archive reading", async () => {
  const h = harness("production");
  await assert.rejects(h.Page({ get searchParams() { assert.fail("Production must refuse before observing its query"); } }), error => error === NOT_FOUND);
  assert.equal(h.reads, 0);
});

test("trusted Next control-flow signals remain exceptional and never become a diagnostic recovery result", async () => {
  for (const signal of [() => navigation.notFound(), () => navigation.redirect("/editorial-preview")]) {
    let expected; try { signal(); } catch (error) { expected = error; }
    assert.ok(expected); const h = harness();
    await assert.rejects(h.render(Promise.reject(expected)), error => error === expected);
    assert.equal(h.reads, 0);
  }
});
