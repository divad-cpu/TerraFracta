import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sourceMonitoringFilter } from "../src/source-monitoring-filter.ts";
import { createInventedSourceMonitoringSnapshot } from "../app/editorial-preview/source-health/example.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { sharedViewModule } from "./helpers/shared_view_module.mjs";
const View = loadTsx(new URL("../src/source-monitoring-view.tsx", import.meta.url)).SourceMonitoringView;
const Explorer = loadTsx(new URL("../src/source-monitoring-explorer.tsx", import.meta.url)).SourceMonitoringExplorer;
const render = (filter, input = createInventedSourceMonitoringSnapshot()) => renderToStaticMarkup(View({ input, filter }));
const mount = sharedViewModule(new URL("../src/source-monitoring-explorer.tsx", import.meta.url), "SourceMonitoringExplorer");

test("display filter grammar preserves the two original required finite observation axes", () => {
  assert.deepEqual(sourceMonitoringFilter({ check: "failed", permission: "unresolved" }), { check: "failed", permission: "unresolved" });
  for (const input of [null, [], {}, { check: [], permission: "" }, { check: "healthy", permission: "" },
    { check: "", permission: "public_reuse_allowed" }, { check: "", permission: "", provider: "PRIVATE_VALUE" },
    { get check() { throw Error("PRIVATE_VALUE"); }, permission: "" }]) assert.equal(sourceMonitoringFilter(input), null);
});
test("one check filter narrows rows without changing total failure or permission counts", () => {
  const html = render({ check: "complete_unchanged", permission: "" });
  assert.match(html, /Showing 2 of 8 source observations/);
  assert.match(html, /failed: 1\./); assert.match(html, /fetch denied: 1/); assert.match(html, /fetch permission unresolved: 1/);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 2);
  assert.match(html, /Suspended/);
  assert.match(html, /Totals above include filtered-out observations/);
  assert.match(html, /2026-10-14T12:00:00.000000Z/);
});
test("zero matches remain distinct from empty supplied observations and unavailable data", () => {
  const html = render({ check: "complete_unchanged", permission: "denied" });
  assert.match(html, /Showing 0 of 8 source observations/);
  assert.match(html, /No observations match these display filters/);
  assert.match(html, /failed: 1\./); assert.doesNotMatch(html, /No source observations supplied|unavailable|<table/);
  const value = createInventedSourceMonitoringSnapshot(); value.sources = [];
  assert.match(render({ check: "failed", permission: "" }, value), /No source observations supplied/);
  assert.match(render({ check: "failed", permission: "" }, null), /unavailable/);
});
test("filtered detail references retain exact full-snapshot target numbers", () => {
  const all = render({ check: "", permission: "" }), filtered = render({ check: "failed", permission: "" });
  const targets = [...filtered.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
  assert.equal(targets.length, 1);
  assert.match(all, new RegExp(`id="${targets[0]}"`));
  assert.equal((filtered.match(new RegExp(`id="${targets[0]}"`, "g")) ?? []).length, 1);
});
test("malformed filters refuse opaquely instead of falling back to all or hiding failures", () => {
  const html = render({ check: "failed", permission: "", secret: "PRIVATE_VALUE" });
  assert.match(html, /Check the display filters/);
  assert.doesNotMatch(html, /PRIVATE_VALUE|Invented source|Showing|<table/);
});
test("native initial controls are labelled, local and limited to display filtering", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No source request"));
  const html = renderToStaticMarkup(createElement(Explorer, { input: createInventedSourceMonitoringSnapshot() }));
  for (const id of ["source-monitoring-check-filter", "source-monitoring-permission-filter", "source-monitoring-registration-filter", "source-monitoring-due-filter"]) {
    assert.match(html, new RegExp(`for="${id}"`)); assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.equal((html.match(/<select/g) ?? []).length, 4); assert.match(html, /Clear display filters/);
  assert.match(html, /<button type="button" disabled=""/); assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /<form|<input|<textarea|href="https?:/);
});
test("rapid changes to both native selectors preserve their intersection and reset restores all rows", () => {
  const view = mount({ input: createInventedSourceMonitoringSnapshot() });
  const selects = view.nodes().filter(node => node.type === "select");
  selects[0].props.onChange({ currentTarget: { value: "failed" } });
  selects[1].props.onChange({ currentTarget: { value: "denied" } });
  assert.match(view.html(), /Showing 0 of 8 source observations/);
  assert.match(view.html(), /failed: 1\./);
  const reset = view.nodes().find(node => node.type === "button"); assert.equal(reset.props.disabled, false);
  reset.props.onClick(); assert.match(view.html(), /Showing 8 of 8 source observations/);
  assert.equal(view.nodes().find(node => node.type === "button").props.disabled, true);
});
test("all recorded check states filter exactly while permission stays an independent axis", () => {
  for (const [check, count] of [["not_recorded", 2], ["failed", 1], ["coverage_unknown", 1], ["incomplete", 1], ["complete_changed", 1], ["complete_unchanged", 2]]) {
    const html = render({ check, permission: "" }); assert.ok(html.includes(`Showing ${count} of 8 source observations`), check);
  }
  for (const [permission, count] of [["allowed", 6], ["denied", 1], ["unresolved", 1]])
    assert.ok(render({ check: "", permission }).includes(`Showing ${count} of 8 source observations`));
});
test("separate mounted explorers never share filter state or update their supplied observation dates", () => {
  const first = mount({ input: createInventedSourceMonitoringSnapshot() }), second = mount({ input: createInventedSourceMonitoringSnapshot() });
  first.nodes().find(node => node.type === "select").props.onChange({ currentTarget: { value: "failed" } });
  assert.match(first.html(), /Showing 1 of 8/); assert.match(second.html(), /Showing 8 of 8/);
  assert.match(first.html(), /2026-10-14T12:00:00.000000Z/); assert.match(second.html(), /2026-10-14T12:00:00.000000Z/);
});
test("invalid input replacement removes controls and stale observations without fetching", () => {
  const props = { input: createInventedSourceMonitoringSnapshot() }, view = mount(props);
  assert.match(view.html(), /Showing 8 of 8/); props.input = null;
  const html = view.html(); assert.match(html, /unavailable/);
  assert.doesNotMatch(html, /<select|Clear display filters|Showing|Invented failed check/);
});
