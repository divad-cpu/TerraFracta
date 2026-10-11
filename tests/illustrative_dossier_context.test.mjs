import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoIssue } from "../src/demo-content.ts";
import { parseIllustrativeIssue } from "../src/prototype-contract.ts";

// Actual parsed synthetic content and React SSR; no source, Browser or server.
function load(file) {
  const native = createRequire(file), exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", code)(name => {
    if (name.startsWith(".")) {
      const next = new URL(name, file);
      if (next.pathname.endsWith(".tsx")) return load(next);
      if (existsSync(new URL(next.href + ".tsx"))) return load(new URL(next.href + ".tsx"));
      if (existsSync(new URL(next.href + ".ts"))) return native(name + ".ts");
    }
    return native(name);
  }, exports);
  return exports;
}
const render = relative => renderToStaticMarkup(createElement(load(new URL(relative, import.meta.url)).default));
const dossier = () => render("../app/countries/norway/issues/housing-costs/page.tsx");

test("actual dossier states its population, geography, measure, denominator, periods and selection before indicators", () => {
  const html = dossier(), firstFigure = html.indexOf('class="indicator"');
  for (const label of ["Affected population", "Geographic scope", "Measurement definition", "Denominator", "Observation periods", "Why this example was selected"])
    assert.ok(html.indexOf(label) > 0 && html.indexOf(label) < firstFigure, label);
  assert.ok(html.includes("No real-source search has been performed"));
  assert.ok(html.includes("not a ranking"));
  assert.ok(!html.includes("Verified population"));
});
test("country card and dossier reuse the same concise problem, response and outcome brief", () => {
  assert.ok(demoIssue.brief, "Shared scoped brief is absent");
  const country = render("../app/countries/norway/page.tsx"), issue = dossier();
  for (const text of Object.values(demoIssue.brief)) {
    assert.ok(country.includes(text), "Country brief missing"); assert.ok(issue.includes(text), "Dossier brief missing");
  }
  assert.ok(country.includes("0 verified")); assert.ok(issue.includes("Entire dossier is illustrative"));
});
test("timeline keeps event or delivery time separate from publication time and labels invented calendar values", () => {
  const html = dossier();
  assert.ok(html.includes("All calendar dates below are invented"));
  assert.ok(html.includes("Event date / period")); assert.ok(html.includes("Reported / published"));
  assert.ok(html.includes("Planned example")); assert.ok(html.includes("Funding allocation"));
  assert.ok(html.includes("2030 (year only)")); assert.ok(!html.includes("2030-01-01"));
  assert.ok(html.includes("2026-08 (month only)")); assert.ok(!html.includes("2026-08-01"));
  assert.ok(html.includes("Not supplied"));
});
test("synthetic parser admits exact, month, year, symbolic and missing dates without widening its source boundary", () => {
  for (const date of [{ precision: "day", value: "2024-02-29" }, { precision: "month", value: "2026-09" },
    { precision: "year", value: "2030" }, { precision: "period", label: "Example period A" }, { precision: "not_supplied" }]) {
    const issue = structuredClone(demoIssue);
    issue.timeline[0].eventDate = date; issue.timeline[0].reportedDate = date;
    const parsed = parseIllustrativeIssue(issue);
    assert.deepEqual(parsed.timeline[0].eventDate, date);
    assert.deepEqual(parsed.timeline[0].reportedDate, date);
    assert.equal(parsed.timeline[0].source, null);
  }
});
test("impossible, ambiguous or augmented dates and unclassified stage cannot enter the sample", () => {
  for (const date of [{ precision: "day", value: "2026-02-29" }, { precision: "month", value: "2026-13" },
    { precision: "year", value: "2030-01-01" }, { precision: "day", value: "03/04/2026" },
    { precision: "not_supplied", value: "2026-01-01" }, { precision: "period", label: "" },
    { precision: "day", value: "2026-09-01", rawArchivePath: "private-canary" }]) {
    const issue = structuredClone(demoIssue); issue.timeline[0].eventDate = date;
    assert.throws(() => parseIllustrativeIssue(issue));
  }
  for (const stage of [undefined, "delivered", "accepted"]) {
    const issue = structuredClone(demoIssue); issue.timeline[0].stage = stage;
    assert.throws(() => parseIllustrativeIssue(issue));
  }
});
test("scope and shared brief are mandatory closed synthetic metadata, never real-source/publication permission", () => {
  assert.ok(demoIssue.scope && demoIssue.brief, "Scoped metadata is absent");
  for (const mutate of [v => { delete v.scope.population; }, v => { v.scope.rawArchivePath = "private-canary"; },
    v => { v.brief.problem = ""; }, v => { v.timeline[0].source = "https://example.org/source"; },
    v => { v.reviewState = "accepted"; }, v => { v.contentKind = "published"; }]) {
    const issue = structuredClone(demoIssue); mutate(issue);
    assert.throws(() => parseIllustrativeIssue(issue));
  }
});

test("actual timeline renders declared precision, authored order and stage without a time-based success promotion", () => {
  const Timeline = load(new URL("../app/illustrative-timeline.tsx", import.meta.url)).IllustrativeTimeline;
  const issue = structuredClone(demoIssue);
  issue.timeline = [issue.timeline[1], issue.timeline[0]];
  const html = renderToStaticMarkup(createElement(Timeline, { records: parseIllustrativeIssue(issue).timeline }));
  assert.ok(html.indexOf("An example budget allocates funding") < html.indexOf("An example eligibility rule is changed"));
  assert.ok(html.includes('dateTime="2026-08"')); assert.ok(html.includes('dateTime="2026-09-10"'));
  assert.ok(!html.includes('dateTime="2030-01-01"')); assert.ok(!html.includes('dateTime="2030"'));
  assert.ok(html.includes("Planned example")); assert.ok(!html.includes("Programme delivered"));
  assert.ok(html.includes("separately from actual spending"));
});
test("actual date presenter escapes symbolic labels and never substitutes the page or review date for missing time", () => {
  const DateValue = load(new URL("../app/illustrative-timeline.tsx", import.meta.url)).IllustrativeDateValue;
  const symbolic = renderToStaticMarkup(createElement(DateValue, { date: { precision: "period", label: "<script>period-canary</script>" } }));
  assert.ok(symbolic.includes("&lt;script&gt;")); assert.ok(!symbolic.includes("<script>"));
  const absent = renderToStaticMarkup(createElement(DateValue, { date: { precision: "not_supplied" } }));
  assert.equal(absent, "<span>Not supplied</span>");
});
