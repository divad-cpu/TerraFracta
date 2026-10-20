import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { createInventedSourceMonitoringSnapshot } from "../app/editorial-preview/source-health/example.ts";

const route = new URL("../app/editorial-preview/source-health/page.tsx", import.meta.url);

test("production refusal precedes invented fixture construction or rendering", () => {
  let constructed = 0, rendered = 0; const marker = new Error("NOT_FOUND");
  for (const NODE_ENV of ["production", "test"]) {
    const Page = loadTsx(route, name => name === "next/navigation" ? { notFound() { throw marker; } }
      : name === "./example.ts" ? { createInventedSourceMonitoringSnapshot() { constructed++; throw Error("PRIVATE_FACTORY"); } }
      : name === "../../../src/source-monitoring-explorer.tsx" ? { SourceMonitoringExplorer() { rendered++; throw Error("PRIVATE_VIEW"); } }
      : undefined, { env: { NODE_ENV } }).default;
    assert.throws(() => Page(), error => error === marker);
  }
  assert.equal(constructed, 0); assert.equal(rendered, 0);
});

test("actual development route constructs one invented snapshot and is dynamic and noindex", t => {
  let constructed = 0; t.mock.method(globalThis, "fetch", () => assert.fail("No provider or source fetch permitted"));
  const page = loadTsx(route, name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); } }
    : name === "./example.ts" ? { createInventedSourceMonitoringSnapshot() { constructed++; return createInventedSourceMonitoringSnapshot(); } } : undefined);
  const html = renderToStaticMarkup(page.default());
  assert.equal(constructed, 1); assert.equal(page.dynamic, "force-dynamic");
  assert.deepEqual(page.metadata.robots, { index: false, follow: false });
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /operational source-health connection remains unconfigured/);
  assert.match(html, /href="\/editorial-preview\/exceptions"/);
  assert.match(html, /Entirely invented/); assert.doesNotMatch(html, /<form|<input/);
  assert.equal((html.match(/<select/g) ?? []).length, 4);
  assert.match(html, /Clear display filters/);
});

test("existing overview exposes a labelled invented example while preserving unavailable actual health", async () => {
  const page = loadTsx(new URL("../app/editorial-preview/exceptions/page.tsx", import.meta.url),
    name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); }, unstable_rethrow() {} } : undefined).default;
  const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));
  assert.match(html, /Current source health is unavailable/);
  assert.match(html, /default record connections remain unconfigured/);
  assert.match(html, /href="\/editorial-preview\/source-health">Explore an invented source-monitoring example/);
});
