import assert from "node:assert/strict";
import test from "node:test";
import { findIllustrativeIssues, findIllustrativeCountries, sampleCorrectionSection, sampleIssuePath } from "../src/visitor-catalog.ts";
import { demoIssue } from "../src/demo-content.ts";

test("the catalog exposes only the existing illustrative case with explicit evidence state", () => {
  const result = findIllustrativeIssues({});
  assert.equal(result.kind, "valid"); assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].title, demoIssue.title);
  assert.equal(result.issues[0].href, sampleIssuePath);
  assert.equal(result.issues[0].coverage, "Demonstration only");
  assert.equal(result.issues[0].evidenceReview, "Not performed");
  assert.ok(Object.isFrozen(result.issues[0]));
  assert.ok(!JSON.stringify(result).includes("publishedAt"));
});
test("word intersection, place aliases, normalization and exact topic find the same case", () => {
  for (const q of ["norWAY housing", "Ｎｏｒｗａｙ", "norge", " household  budgets ", "housing norway"])
    assert.equal(findIllustrativeIssues({ q, topic: "housing" }).issues.length, 1, q);
  assert.equal(findIllustrativeIssues({ q: "housing missing" }).issues.length, 0);
  assert.equal(findIllustrativeIssues({ q: "other place" }).issues.length, 0);
});
test("malformed and unsupported selectors cannot silently become a successful empty search", () => {
  for (const input of [null, [], "Norway", { q: null }, { q: ["Norway"] }, { topic: ["housing"] },
    { q: "x".repeat(81) }, { q: "Norway\0" }, { q: "\ufdfa".repeat(5) },
    { topic: "political-ranking" }, { topic: null }, { source: "private-canary" }, { path: "/tmp/private" }]) {
    const result = findIllustrativeIssues(input);
    assert.equal(result.kind, "invalid", JSON.stringify(input));
    assert.deepEqual(result.issues, []); assert.equal(result.query, "");
  }
});
test("fresh result arrays cannot change later catalog coverage", () => {
  findIllustrativeIssues({}).issues.splice(0);
  assert.equal(findIllustrativeIssues({}).issues.length, 1);
});
test("sample correction routing admits only existing sections and an explicit page scope", () => {
  assert.equal(sampleCorrectionSection({}), null);
  for (const section of ["problem", "response", "uncertainty", "sources"])
    assert.equal(sampleCorrectionSection({ section }), section);
  for (const input of [null, [], { section: "" }, { section: null }, { section: ["problem"] },
    { section: "constructor" }, { section: "__proto__" }, { section: "../private" },
    { section: "sources-other" }, { section: "sources", sourceUrl: "https://example.org/private-canary" },
    { section: "problem", publicationId: "invented-private-canary" }])
    assert.equal(sampleCorrectionSection(input), "invalid");
});

test("shared country discovery has closed selectors, all-word aliases and cannot manufacture country coverage", () => {
  assert.equal(findIllustrativeCountries({ q: "Ｎｏｒｗａｙ norge" }).countries.length, 1);
  assert.equal(findIllustrativeCountries({ q: "housing" }).countries.length, 0);
  for (const query of [{ q: ["Norway"] }, { q: "x".repeat(81) }, { topic: "housing" }, { q: "Norway", path: "/tmp/private" }])
    assert.equal(findIllustrativeCountries(query).kind, "invalid");
  findIllustrativeCountries({}).countries.pop();
  assert.equal(findIllustrativeCountries({}).countries[0].name, findIllustrativeIssues({}).issues[0].country);
});
