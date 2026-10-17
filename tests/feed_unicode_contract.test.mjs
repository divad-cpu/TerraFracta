import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { feedDiscoveryReport as parse } from "../src/feed-discovery-report.ts";
import { loadTsx } from "./helpers/tsx_loader.mjs";
import { equalWindowReport } from "./helpers/feed_report_contract_fixture.mjs";
const View = loadTsx(new URL("../src/feed-discovery-view.tsx", import.meta.url)).FeedDiscoveryView;
function change(report, field, value) {
  report.current.entries[0][field] = value; report.previous.entries[0][field] = value;
}
for (const field of ["title", "entry_id"]) {
  test(`${field} has the producer's300 Unicode-scalar capacity without truncation`, () => {
    for (const count of [150, 151, 300]) {
      const report = equalWindowReport(), value = "\u{1f30d}".repeat(count); change(report, field, value);
      const checked = parse(report); assert.ok(checked, String(count)); assert.equal(checked.current.entries[0][field], value);
    }
    const report = equalWindowReport(); change(report, field, "\u{1f30d}".repeat(301)); assert.equal(parse(report), null);
  });
}
test("both unparsed date texts keep the producer's160-scalar ceiling", () => {
  for (const field of ["published_text", "updated_text"]) {
    for (const count of [80, 81, 160]) {
      const report = equalWindowReport(), value = "\u{10400}".repeat(count); change(report, field, value);
      assert.equal(parse(report)?.current.entries[0][field], value);
    }
    const report = equalWindowReport(); change(report, field, "\u{10400}".repeat(161)); assert.equal(parse(report), null);
  }
});
test("known held identities use the same300-scalar field contract", () => {
  const report = equalWindowReport(), value = "\u{1f30d}".repeat(300);
  report.current.held[0].entry_id = value; report.previous.held[0].entry_id = value;
  assert.equal(parse(report)?.current.held[0].entry_id, value);
  report.current.held[0].entry_id += "x"; report.previous.held[0].entry_id += "x";
  assert.equal(parse(report), null);
});
test("Python blank semantics preserve BOM and boundary whitespace but refuse all-NEL text", () => {
  for (const value of ["\ufeff", "\u0085\ufeff\u0085", "  unchanged boundaries  ", "\u0085x\u0085", "\u007f", "\u009f"]) {
    const report = equalWindowReport(); change(report, "title", value);
    assert.equal(parse(report)?.current.entries[0].title, value, JSON.stringify(value));
  }
  for (const value of ["\u0085", " \u0085 ", "\u2003\u3000"]) {
    const report = equalWindowReport(); change(report, "title", value); assert.equal(parse(report), null);
  }
});
test("lone surrogates, C0 controls, empty and whitespace-only fields cannot become source text", () => {
  for (const value of ["\ud800", "\udfff", "x\ud800y", "x\u0000y", "x\u001fy", "", "   "]) {
    const report = equalWindowReport(); change(report, "title", value); assert.equal(parse(report), null);
  }
});
test("real view preserves a long supplementary-plane title verbatim and remains passive", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No request"));
  const report = equalWindowReport(), value = "\u{1f30d}".repeat(300); change(report, "title", value);
  const html = renderToStaticMarkup(View({ input: report }));
  assert.ok(html.includes(value)); assert.doesNotMatch(html, /Discovery report unavailable|href=|<script/);
});
