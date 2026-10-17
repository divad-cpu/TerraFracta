import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { feedReport } from "./helpers/feed_discovery_fixture.mjs";
const route = new URL("../app/editorial-preview/source-discovery/page.tsx", import.meta.url);

test("production and test modes refuse before the discovery view is invoked", () => {
  let rendered = 0; const marker = Error("NOT_FOUND");
  for (const NODE_ENV of ["production", "test"]) {
    const Page = loadTsx(route, name => name === "next/navigation" ? { notFound() { throw marker; } }
      : name === "../../../src/feed-discovery-view.tsx" ? { FeedDiscoveryView() { rendered++; throw Error("VIEW"); } } : undefined,
    { env: { NODE_ENV } }).default;
    assert.throws(() => Page(), error => error === marker);
  }
  assert.equal(rendered, 0);
});
test("actual fixed development page renders producer-backed invented report with return links", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No source request permitted"));
  // The narrow TSX loader does not enable the project's esModuleInterop.
  // Supply the real JSON fixture under its actual bundler default-import shape.
  const page = loadTsx(route, name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); } }
    : name === "../../../fixtures/fictional-feed-discovery.json" ? { default: feedReport() } : undefined);
  const html = renderToStaticMarkup(page.default());
  assert.equal(page.dynamic, "force-dynamic"); assert.deepEqual(page.metadata.robots, { index: false, follow: false });
  assert.equal((html.match(/<h1>/g) ?? []).length, 1); assert.match(html, /Entirely invented/);
  assert.match(html, /offline Python parser and comparison engine/); assert.match(html, /development gate is not authentication/);
  assert.match(html, /href="\/editorial-preview\/source-health"/); assert.match(html, /href="\/editorial-preview\/exceptions"/);
  assert.match(html, /Invented revised title/); assert.doesNotMatch(html, /<form|<button|<input/);
});
test("monitoring example has a labelled link to the passive discovery comparison", () => {
  const page = loadTsx(new URL("../app/editorial-preview/source-health/page.tsx", import.meta.url),
    name => name === "next/navigation" ? { notFound() { throw Error("NOT_FOUND"); } } : undefined);
  assert.match(renderToStaticMarkup(page.default()), /href="\/editorial-preview\/source-discovery">Inspect an invented feed-discovery comparison/);
});
