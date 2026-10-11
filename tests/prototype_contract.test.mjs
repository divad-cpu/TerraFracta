import assert from "node:assert/strict";
import test from "node:test";
import { parseIllustrativeIssue } from "../src/prototype-contract.ts";
import { demoIssue } from "../src/demo-content.ts";

test("the bundled illustrative issue passes the explicit content contract", () => {
  assert.equal(demoIssue.contentKind, "synthetic_local_example");
  assert.equal(parseIllustrativeIssue(demoIssue).reviewState, "not_reviewed");
});

test("a publication-shaped or unreviewed real-source record cannot enter the demo route", () => {
  assert.throws(() => parseIllustrativeIssue({ ...demoIssue, contentKind: "published" }));
  assert.throws(() => parseIllustrativeIssue({ ...demoIssue, reviewState: "accepted" }));
  assert.throws(() => parseIllustrativeIssue({
    ...demoIssue,
    indicators: [{ ...demoIssue.indicators[0], source: "https://example.org/data" }],
  }));
});

test("the display refuses missing periods and unexpected private fields", () => {
  const { period: _period, ...withoutPeriod } = demoIssue.indicators[0];
  assert.throws(() => parseIllustrativeIssue({ ...demoIssue, indicators: [withoutPeriod] }));
  assert.throws(() => parseIllustrativeIssue({ ...demoIssue, rawArchivePath: "/private/raw" }));
});
