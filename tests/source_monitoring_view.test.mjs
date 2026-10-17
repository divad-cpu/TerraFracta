import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { source, snapshot, attempt } from "./helpers/source_monitoring_fixture.mjs";
import { createInventedSourceMonitoringSnapshot } from "../app/editorial-preview/source-health/example.ts";

const View = loadTsx(new URL("../src/source-monitoring-view.tsx", import.meta.url)).SourceMonitoringView;
const render = input => renderToStaticMarkup(View({ input }));

test("actual monitoring view keeps every state axis and separate dated provenance", () => {
  const html = render(createInventedSourceMonitoringSnapshot());
  for (const label of ["Entirely invented", "Not due at this observation", "Due time not recorded", "Suspended",
    "Fetch permission unresolved", "Fetch denied", "No check recorded", "Incomplete recorded check", "Coverage unknown",
    "Recorded check failed", "Recorded check completed; no change reported", "Recorded check completed; change reported"])
    assert.ok(html.includes(label), label);
  assert.match(html, /dateTime="2026-10-14T12:00:00.000000Z"/i);
  assert.match(html, /dateTime="2026-10-13T08:00:00.000000Z"/i);
  assert.match(html, /Counts on different axes overlap/);
  assert.match(html, /Completed: 1; failed: 0; pending: 1; expected: 3/);
  assert.match(html, /Unobserved: 1/);
  assert.match(html, /Any reported change or no-change covers inspected units only/);
});

test("unavailable, no sources, no attempt and known complete checks remain visibly different", () => {
  const unavailable = render(null), empty = render(snapshot([])), absent = render(snapshot()), complete = render(snapshot([source({ lastAttempt: attempt() })]));
  assert.match(unavailable, /unavailable/); assert.doesNotMatch(unavailable, /0 source observations/);
  assert.match(empty, /No source observations supplied/); assert.doesNotMatch(empty, /<table/);
  assert.match(absent, /No check time, HTTP result or coverage counts were supplied/);
  assert.match(complete, /Reported result covers the explicitly defined units of this check only/);
  assert.doesNotMatch(absent, /Recorded check completed/);
});

test("semantic table, scroll region and exact details targets are present without write or network controls", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No source request is permitted"));
  const html = render(createInventedSourceMonitoringSnapshot());
  assert.match(html, /<caption>/); assert.equal((html.match(/scope="col"/g) ?? []).length, 5);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 8);
  assert.match(html, /role="region" aria-label="Invented source observations table" tabindex="0"/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.equal(ids.filter(value => value === id).length, 1);
  assert.doesNotMatch(html, /<form|<input|<button|<textarea|href="https?:|<script|data-source-url/);
});

test("hostile supplied text stays escaped and malformed private fields never appear", () => {
  const html = render(snapshot([source({ label: '<script>PRIVATE_LABEL</script>' })]));
  assert.match(html, /&lt;script&gt;PRIVATE_LABEL&lt;\/script&gt;/); assert.doesNotMatch(html, /<script/);
  const invalid = render({ ...snapshot(), archivePath: "/tmp/PRIVATE_PATH" });
  assert.match(invalid, /unavailable/); assert.doesNotMatch(invalid, /PRIVATE_PATH|Invented source one|source-monitoring-table/);
});

test("fixed fixture construction is fresh and never changes its observation dates on render", () => {
  const first = createInventedSourceMonitoringSnapshot(), second = createInventedSourceMonitoringSnapshot();
  assert.deepEqual(first, second); first.sources[0].label = "Locally changed example";
  assert.notEqual(first.sources[0].label, second.sources[0].label);
  assert.equal(second.observedAt, "2026-10-14T12:00:00.000000Z");
});
