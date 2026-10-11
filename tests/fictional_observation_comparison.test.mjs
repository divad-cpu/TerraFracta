import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareFictionalObservations, exportFictionalComparison } from "../src/fictional-observation-comparison.ts";

const before = JSON.parse(readFileSync(new URL("../fixtures/fictional_update_report.json",import.meta.url))).fictionalCandidate;
const after = JSON.parse(readFileSync(new URL("../fixtures/fictional_revised_update_report.json",import.meta.url))).fictionalCandidate;
const copy = () => structuredClone(after);

test("same-period revision derives exact percentage points from source-bound drafts", () => {
  const result = compareFictionalObservations(before, after);
  assert.equal(result.kind,"changed");
  assert.equal(result.beforeValue,"27.4"); assert.equal(result.afterValue,"28.1");
  assert.equal(result.deltaPercentagePoints,"+0.7"); assert.equal(result.period,"2025");
  assert.equal(result.afterUrl,"https://example.org/fictional-table");
});
test("equal source version reports an unchanged observation", () => {
  const result = compareFictionalObservations(before,before);
  assert.equal(result.kind,"unchanged"); assert.equal(result.deltaPercentagePoints,"0.0");
});
test("a changed value cannot borrow the old hash or source version", () => {
  for (const key of ["sourceVersionId","contentSha256"]) {
    const changed = copy(); changed.decision[key] = before.decision[key];
    if (key === "sourceVersionId") {
      changed.publication.snapshot.claims[0].evidence[0].sourceVersionId = before.decision[key];
      changed.publication.dependencyManifest.sourceVersionIds = [before.decision[key]];
    }
    assert.deepEqual(compareFictionalObservations(before,changed),{kind:"held"});
  }
});
test("different period, mapping or source location must not be treated as a revision", () => {
  for (const mutate of [
    p => { p.observation.period="2024";p.publication.snapshot.claims[0].periodLabel="2024";p.publication.snapshot.claims[0].assertion="In 2024, the fictional share was 28.1%."; },
    p => { p.observation.semanticContractSha256="e".repeat(64);p.decision.semanticContractSha256="e".repeat(64); },
    p => { p.decision.locator="other row";p.publication.snapshot.claims[0].evidence[0].locator="other row"; },
  ]) { const changed=copy();mutate(changed);assert.deepEqual(compareFictionalObservations(before,changed),{kind:"held"}); }
});
test("reversed or equal retrieval times hold changed observations", () => {
  for (const retrievedAt of ["2026-09-27T06:00:00Z",before.publication.snapshot.claims[0].evidence[0].retrievedAt]) {
    const changed=copy();changed.publication.snapshot.claims[0].evidence[0].retrievedAt=retrievedAt;
    assert.deepEqual(compareFictionalObservations(before,changed),{kind:"held"});
  }
});
test("a negative same-period revision keeps direction and exact units", () => {
  const changed=copy();changed.observation.value="26.7";
  changed.publication.snapshot.claims[0].assertion="In 2025, the fictional share was 26.7%.";
  assert.equal(compareFictionalObservations(before,changed).deltaPercentagePoints,"−0.7");
});
test("unverified text, held dispositions and extra approval fields fail closed", () => {
  for (const mutate of [p=>{p.decision.disposition="eligible";},p=>{p.approved=true;},
    p=>{p.publication.snapshot.claims[0].assertion="Invented claim not derived from the value";}]) {
    const changed=copy();mutate(changed);assert.deepEqual(compareFictionalObservations(before,changed),{kind:"held"});
  }
  assert.deepEqual(compareFictionalObservations(null,after),{kind:"held"});
});
test("export preserves exact values and provenance while remaining an unpublished fictional draft", () => {
  const artifact = JSON.parse(exportFictionalComparison(before,after));
  assert.equal(artifact.artifactKind,"fictional_observation_comparison");
  assert.equal(artifact.state,"draft"); assert.equal(artifact.publicChanges,0);
  assert.equal(artifact.deltaPercentagePoints,"+0.7");
  for (const [key,candidate] of [["before",before],["after",after]]) {
    assert.equal(artifact[key].value,candidate.observation.value);
    assert.equal(artifact[key].contentSha256,candidate.decision.contentSha256);
    assert.equal(artifact[key].url,candidate.decision.publicCitationUrl);
  }
  assert.equal("runId" in artifact,false);assert.equal("leaseId" in artifact,false);
  assert.throws(()=>exportFictionalComparison(null,after),/cannot be exported/);
});
