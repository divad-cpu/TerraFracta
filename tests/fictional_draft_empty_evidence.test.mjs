import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { updateRunReportSchema, parseUpdateRunReport } from "../src/update-run-report.ts";
import { fictionalUpdateResultSchema } from "../src/fictional-update-result.ts";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));

function missing(kind) {
  const report = structuredClone(fixture);
  if (kind === "claims") report.fictionalCandidate.publication.snapshot.claims = [];
  else report.fictionalCandidate.publication.snapshot.claims[0].evidence = [];
  return report;
}

test("empty draft claims remain a normal validation refusal", () => {
  const report = missing("claims");
  assert.equal(updateRunReportSchema.safeParse(report).success, false);
  assert.throws(() => parseUpdateRunReport(report), z.ZodError);
});

test("empty draft evidence remains a normal validation refusal", () => {
  const report = missing("evidence");
  assert.equal(updateRunReportSchema.safeParse(report).success, false);
  assert.throws(() => parseUpdateRunReport(report), z.ZodError);
});

test("the full saved-result boundary refuses both incomplete draft shapes", () => {
  for (const kind of ["claims", "evidence"]) {
    const wrapper = {
      execution: { id: "11111111-1111-4111-8111-111111111111", kind: "local_fictional",
        scenario: "standard", executedAt: "2026-09-29T12:00:00Z", durationMs: 1 },
      report: missing(kind),
    };
    assert.equal(fictionalUpdateResultSchema.safeParse(wrapper).success, false);
    assert.throws(() => fictionalUpdateResultSchema.parse(wrapper), z.ZodError);
  }
});

test("a complete draft and an explicitly absent draft retain their display contract", () => {
  assert.equal(updateRunReportSchema.safeParse(fixture).success, true);
  assert.equal(updateRunReportSchema.safeParse({ ...fixture, fictionalCandidate: null }).success, true);
});
