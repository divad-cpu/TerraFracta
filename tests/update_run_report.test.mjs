import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseUpdateRunReport } from "../src/update-run-report.ts";

test("the checked-in shared-run fixture passes the operator display boundary", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json", import.meta.url), "utf8"));
  const report = parseUpdateRunReport(fixture);
  assert.equal(report.items.length, 4);
  assert.deepEqual(report.items.map((item) => item.outcome), ["shadow_only", "held", "unchanged", "held"]);
  assert.equal(report.items[1].source.locator,
    "series=fictional-share;geography=fictional-country;period=2024");
});

function example() {
  return {
    schemaVersion: 3,
    reportKind: "fictional_rehearsal",
    runId: "11111111-1111-4111-8111-111111111111",
    requestKey: "fictional:manual:2026w40",
    requestFingerprint: "a".repeat(64),
    trigger: "manual",
    scheduledDueAt: null,
    mode: "shadow",
    scope: "fictional-country",
    dueSourceKeys: ["fictional-source"],
    coveredSourceKeys: ["fictional-source"],
    state: "completed",
    startedAt: "2026-09-29T12:00:00Z",
    finishedAt: "2026-09-29T12:01:00Z",
    publicChanges: 0,
    fictionalCandidate: null,
    items: [{
      itemKey: "fictional-period-2025",
      outcome: "shadow_only",
      reasonCodes: ["shadow_mode"],
      sourceKey: "fictional-source",
      sourceBindingValid: true,
      source: {
        sourceVersionId: "22222222-2222-4222-8222-222222222222",
        publisher: "Fictional publisher", title: "Fictional table",
        url: "https://example.org/fictional-table",
        locator: "period=2025;measure=fictional-share",
        contentSha256: "a".repeat(64),
        sourceKey: "fictional-source",
      },
      publicUrl: null,
    }],
  };
}

test("fictional shadow report keeps the exact source reference and no public link", () => {
  const report = parseUpdateRunReport(example());
  assert.equal(report.items[0].source.locator, "period=2025;measure=fictional-share");
  assert.equal(report.items[0].publicUrl, null);
});

test("older report shape cannot masquerade as version three", () => {
  assert.throws(() => parseUpdateRunReport({ ...example(), schemaVersion: 1 }));
});

test("version two cannot enter the new failure-disclosure contract", () => {
  assert.throws(() => parseUpdateRunReport({ ...example(), schemaVersion: 2 }));
});

test("unverified item may be shown held with source details withheld and incomplete coverage", () => {
  const invalid = example();
  invalid.state = "partial";
  invalid.coveredSourceKeys = [];
  invalid.items[0].outcome = "held";
  invalid.items[0].reasonCodes = ["source_reference_invalid"];
  invalid.items[0].sourceBindingValid = false;
  invalid.items[0].source = null;
  assert.equal(parseUpdateRunReport(invalid).items[0].source, null);
  for (const changes of [
    { state: "completed" }, { coveredSourceKeys: ["fictional-source"] },
  ]) assert.throws(() => parseUpdateRunReport({ ...invalid, ...changes }));
  const disclosed = structuredClone(invalid);
  disclosed.items[0].source = example().items[0].source;
  assert.throws(() => parseUpdateRunReport(disclosed));
  const mislabeled = structuredClone(invalid);
  mislabeled.items[0].sourceBindingValid = true;
  assert.throws(() => parseUpdateRunReport(mislabeled));
});

test("valid items from the same source cannot conceal an unverified item", () => {
  const mixed = example();
  mixed.state = "partial";
  mixed.coveredSourceKeys = [];
  const unverified = structuredClone(mixed.items[0]);
  unverified.itemKey = "fictional-bad-binding";
  unverified.outcome = "held";
  unverified.reasonCodes = ["candidate_binding_invalid"];
  unverified.sourceBindingValid = false;
  mixed.items.push(unverified);
  assert.equal(parseUpdateRunReport(mixed).state, "partial");
  assert.throws(() => parseUpdateRunReport({ ...mixed, coveredSourceKeys: ["fictional-source"] }));
});

test("unknown fields and non-public source addresses fail", () => {
  const privateField = example();
  privateField.items[0].source.rawArchivePath = "/private/raw";
  assert.throws(() => parseUpdateRunReport(privateField));
  for (const url of [
    "http://example.org/table", "https://localhost/table", "https://intranet/table",
    "https://example.org./table", "https://user:pass@example.org/table",
    "https://example.org/table?api_key=redacted",
    "https://example.org/table?key=redacted",
    "https://example.org/table?%61pi_key=redacted", "https://example.org/table#private",
  ]) {
    const badUrl = example();
    badUrl.items[0].source.url = url;
    assert.throws(() => parseUpdateRunReport(badUrl));
  }
  const realLookingSource = example();
  realLookingSource.items[0].source.url = "https://www.ssb.no/statbank";
  assert.throws(() => parseUpdateRunReport(realLookingSource));
});

test("fictional or shadow reports cannot report publication", () => {
  const published = example();
  published.items[0].outcome = "published";
  published.items[0].publicUrl = "https://example.org/public-fact";
  assert.throws(() => parseUpdateRunReport(published));
  published.reportKind = "verified_run";
  assert.throws(() => parseUpdateRunReport(published));
});

test("unresolved, duplicated or reversed run states fail", () => {
  const unresolved = example();
  unresolved.items[0].outcome = "deferred";
  assert.throws(() => parseUpdateRunReport(unresolved));
  for (const outcome of ["model_candidate", "eligible_for_activation_check"]) {
    const pending = example();
    pending.items[0].outcome = outcome;
    assert.throws(() => parseUpdateRunReport(pending));
  }
  const duplicate = example();
  duplicate.items.push({ ...duplicate.items[0] });
  assert.throws(() => parseUpdateRunReport(duplicate));
  const reversed = example();
  reversed.finishedAt = "2026-09-29T11:59:00Z";
  assert.throws(() => parseUpdateRunReport(reversed));
  const falseCount = example();
  falseCount.publicChanges = 1;
  assert.throws(() => parseUpdateRunReport(falseCount));
  const wrongWeek = example();
  wrongWeek.trigger = "scheduled";
  wrongWeek.requestKey = "fictional:scheduled:2026w40";
  assert.throws(() => parseUpdateRunReport(wrongWeek));
});

test("scheduled report binds its key to Monday 08:00 Oslo across daylight saving", () => {
  for (const [due, key] of [
    ["2025-12-29T07:00:00Z", "weekly:2026w01:fictional-country"],
    ["2026-01-05T07:00:00Z", "weekly:2026w02:fictional-country"],
    ["2026-10-05T06:00:00Z", "weekly:2026w41:fictional-country"],
  ]) {
    const scheduled = example();
    scheduled.trigger = "scheduled";
    scheduled.scheduledDueAt = due;
    scheduled.requestKey = key;
    scheduled.startedAt = new Date(Date.parse(due) + 60_000).toISOString();
    scheduled.finishedAt = new Date(Date.parse(due) + 120_000).toISOString();
    assert.equal(parseUpdateRunReport(scheduled).requestKey, key);
    for (const wrongDue of [null, "2026-10-05T07:00:00Z", "2026-10-06T06:00:00Z"]) {
      assert.throws(() => parseUpdateRunReport({ ...scheduled, scheduledDueAt: wrongDue }));
    }
    assert.throws(() => parseUpdateRunReport({
      ...scheduled, startedAt: new Date(Date.parse(due) - 60_000).toISOString(),
    }));
  }
  assert.throws(() => parseUpdateRunReport({ ...example(), scheduledDueAt: "2026-09-28T06:00:00Z" }));
});

test("missing, substituted and duplicated source coverage cannot complete", () => {
  for (const changes of [
    { coveredSourceKeys: [] },
    { coveredSourceKeys: ["fictional-other"] },
    { dueSourceKeys: ["fictional-source", "fictional-other"] },
    { dueSourceKeys: ["fictional-source", "fictional-source"] },
  ]) {
    assert.throws(() => parseUpdateRunReport({ ...example(), ...changes }));
  }
  const partial = { ...example(), state: "partial", coveredSourceKeys: ["fictional-source"],
    dueSourceKeys: ["fictional-source", "fictional-other"] };
  assert.equal(parseUpdateRunReport(partial).state, "partial");
});

test("a verified partial report can show held work without pretending it published", () => {
  const partial = example();
  partial.reportKind = "verified_run";
  partial.mode = "publish_eligible";
  partial.state = "partial";
  partial.items[0].outcome = "held";
  partial.items[0].reasonCodes = ["material_conflict"];
  assert.equal(parseUpdateRunReport(partial).items[0].outcome, "held");
  partial.items[0].outcome = "eligible_for_activation_check";
  partial.items[0].reasonCodes = ["qualified_checks_passed"];
  assert.equal(parseUpdateRunReport(partial).state, "partial");
  const failedAfterPublication = example();
  failedAfterPublication.reportKind = "verified_run";
  failedAfterPublication.mode = "publish_eligible";
  failedAfterPublication.state = "failed";
  failedAfterPublication.items[0].outcome = "published";
  failedAfterPublication.items[0].publicUrl = "https://example.org/fact";
  failedAfterPublication.publicChanges = 1;
  assert.throws(() => parseUpdateRunReport(failedAfterPublication));
});
