import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { interpretPublicReadCandidate } from "../src/public-read-outcome.ts";
import { decidePublicReadResponse } from "../src/public-read-response.ts";

// Local-only integration rehearsal against the loopback development database.
// Fictional rows and every mutation below roll back in one transaction.
const container = "supabase_db_terrafracta-local";
const fixture = readFileSync(new URL("../tests/fixtures/tf008_public_read_bridge.sql", import.meta.url), "utf8");
const readSql = readFileSync(new URL("../src/public-read-query.sql", import.meta.url), "utf8").trimEnd();
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];

function query(input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 256 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error("Local database bridge command failed; start the loopback database first");
  }
  return result.stdout.trim();
}

const cases = [
  ["accepted", "execute tf_public_read('fictional-place', 'sample-issue');"],
  ["private-root-field", `update terra_private.issue_publications
      set snapshot=snapshot || '{"rawArchivePath":"/private/root-canary"}'::jsonb
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set snapshot=snapshot-'rawArchivePath'
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["private-nested-field", `update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{claims,0,evidence,0}',
        snapshot #> '{claims,0,evidence,0}' || '{"privateNote":"nested-canary"}'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set snapshot=snapshot #- '{claims,0,evidence,0,privateNote}'
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["private-manifest-field", `update terra_private.issue_publications
      set dependency_manifest=dependency_manifest || '{"rawLocation":"manifest-canary"}'::jsonb
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set dependency_manifest=dependency_manifest-'rawLocation'
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["private-manifest-value", `update terra_private.issue_publications
      set dependency_manifest=jsonb_set(dependency_manifest, '{sourceVersionIds,0}',
        '{"private":"array-canary"}'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set dependency_manifest='{"sourceVersionIds":["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]}'::jsonb
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["source-title-changed", `update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{claims,0,evidence,0,title}',
        '"Unreviewed replacement"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{claims,0,evidence,0,title}',
        '"Fictional table"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["source-title-withdrawn", `insert into terra_private.source_display_reviews
      (source_version_id, revision, decision, reviewed_at, review_reference)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 2, 'withdrawn',
        '2026-09-25T12:40:00Z', 'synthetic-withdrawal');
    execute tf_public_read('fictional-place', 'sample-issue');
    insert into terra_private.source_display_reviews
      (source_version_id, revision, decision, display_title, title_language,
       reviewed_at, review_reference)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 3, 'accepted',
        'Fictional table', 'en', '2026-09-25T12:45:00Z', 'synthetic-reacceptance');`],
  ["issue-title-changed", `update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{title}', '"Unreviewed issue title"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{title}', '"Fictional bridge issue"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["issue-summary-changed", `update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{summary}', '"Unreviewed issue summary"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{summary}',
        '"Only synthetic database records are used in this local test."'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["issue-text-withdrawn", `insert into terra_private.issue_text_reviews
      (publication_id, revision, decision, reviewed_at, review_reference)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 2, 'withdrawn',
        '2026-09-25T13:05:00Z', 'synthetic-withdrawal');
    execute tf_public_read('fictional-place', 'sample-issue');
    insert into terra_private.issue_text_reviews
      (publication_id, revision, decision, display_title, display_summary,
       reviewed_at, review_reference)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 3, 'accepted',
        'Fictional bridge issue',
        'Only synthetic database records are used in this local test.',
        '2026-09-25T13:10:00Z', 'synthetic-reacceptance');`],
  ["period-label-changed", `update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{claims,0,periodLabel}',
        '"Unreviewed period"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{claims,0,periodLabel}',
        '"Example period"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["period-withdrawn", `insert into terra_private.claim_period_reviews
      (publication_id, claim_id, revision, decision, reviewed_at,
       review_reference)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, 'withdrawn',
        '2026-09-25T12:45:00Z', 'synthetic-withdrawal');
    execute tf_public_read('fictional-place', 'sample-issue');
    insert into terra_private.claim_period_reviews
      (publication_id, claim_id, revision, decision, period_label,
       reviewed_at, review_reference)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 3, 'accepted',
        'Example period', '2026-09-25T12:50:00Z',
        'synthetic-reacceptance');`],
  ["assertion-changed", `update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{claims,0,assertion}',
        '"Unreviewed fictional assertion"'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.issue_publications
      set snapshot=jsonb_set(snapshot, '{claims,0,assertion}',
        '"A fictional condition is stated for a sample period."'::jsonb)
      where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';`],
  ["assertion-withdrawn", `insert into terra_private.claim_assertion_reviews
      (publication_id, claim_id, revision, decision, reviewed_at,
       review_reference)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, 'withdrawn',
        '2026-09-25T12:55:00Z', 'synthetic-withdrawal');
    execute tf_public_read('fictional-place', 'sample-issue');
    insert into terra_private.claim_assertion_reviews
      (publication_id, claim_id, revision, decision, claim_type,
       display_assertion, reviewed_at, review_reference)
      values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 3, 'accepted',
        'condition', 'A fictional condition is stated for a sample period.',
        '2026-09-25T12:57:00Z', 'synthetic-reacceptance');`],
  ["claim-row-oversize", `update terra_private.claims
      set assertion=repeat('oversized-private-claim-', 60)
      where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.claims
      set assertion='A fictional condition is stated for a sample period.'
      where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';`],
  ["publisher-row-oversize", `update terra_private.source_registrations
      set publisher=repeat('oversized-private-publisher-', 10)
      where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.source_registrations
      set publisher='Fictional publisher'
      where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';`],
  ["url-row-oversize", `update terra_private.source_versions
      set source_url='https://example.org/' || repeat('oversized-private-url-', 100)
      where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    execute tf_public_read('fictional-place', 'sample-issue');
    update terra_private.source_versions
      set source_url='https://example.org/source'
      where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';`],
  ["wrong-country", "execute tf_public_read('another-place', 'sample-issue');"],
  ["wrong-issue", "execute tf_public_read('fictional-place', 'another-issue');"],
  ["quoted-route", "execute tf_public_read('fictional-place'' or true --', 'sample-issue');"],
  ["rights-revoked", `update terra_private.source_registrations
      set allow_public_derived=false where source_key='fictional-bridge-source';
    execute tf_public_read('fictional-place', 'sample-issue');`],
  ["source-changed", `update terra_private.source_registrations
      set allow_public_derived=true where source_key='fictional-bridge-source';
    update terra_private.source_versions set source_url='https://example.org/changed'
      where item_key='fictional-item';
    execute tf_public_read('fictional-place', 'sample-issue');`],
  ["citation-missing", `delete from terra_private.issue_publication_citations
      where publication_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    execute tf_public_read('fictional-place', 'sample-issue');`],
  ["coverage-paused", `update terra_private.jurisdictions
      set coverage_state='maintenance_paused' where id='TF-BRIDGE-SAMPLE';
    execute tf_public_read('fictional-place', 'sample-issue');`],
];
const scenarioSql = cases.map(([label, statement]) => {
  const asReader = statement.replace(
    /(execute tf_public_read\([^;]+;)/g,
    "set local role terra_issue_reader;\n$1\nreset role;",
  );
  return `\\echo CASE:${label}\n${asReader}`;
}).join("\n");
const script = `${fixture}\nprepare tf_public_read(text, text) as\n${readSql};\n${scenarioSql}\nrollback;\n`;
const output = query(script);
const parsed = new Map();
for (const line of output.split("\n")) {
  if (line.startsWith("CASE:")) {
    const label = line.slice(5);
    assert.ok(!parsed.has(label), `Duplicate scenario: ${label}`);
    parsed.set(label, []);
  } else if (line !== "") {
    assert.ok(parsed.size > 0, "Unexpected output before first scenario");
    [...parsed.values()].at(-1).push(line);
  }
}
assert.deepEqual([...parsed.keys()], cases.map(([label]) => label));
function oneCandidate(label) {
  const rows = parsed.get(label);
  assert.equal(rows.length, 1, `${label} must return exactly one candidate`);
  return JSON.parse(rows[0]);
}
const acceptedOutcome = interpretPublicReadCandidate(oneCandidate("accepted"));
assert.equal(acceptedOutcome.kind, "issue");
assert.equal(decidePublicReadResponse(acceptedOutcome).status, 200);
assert.equal(decidePublicReadResponse(acceptedOutcome).cacheControl, "no-store");
const projection = acceptedOutcome.issue;
assert.equal(projection.jurisdictionSlug, "fictional-place");
assert.equal(projection.issueSlug, "sample-issue");
assert.equal(projection.claims.length, 1);
assert.equal(oneCandidate("accepted").sources[0].display_review.display_title, "Fictional table");
assert.equal(oneCandidate("accepted").publication_display_review.display_title, "Fictional bridge issue");
assert.equal(oneCandidate("accepted").claims[0].period_review.period_label, "Example period");
assert.equal(oneCandidate("accepted").claims[0].assertion_review.display_assertion,
  "A fictional condition is stated for a sample period.");
assert.doesNotMatch(JSON.stringify(oneCandidate("accepted")), /review_reference|synthetic-bridge-only/);
for (const label of ["private-root-field", "private-nested-field", "private-manifest-field", "private-manifest-value"]) {
  const candidate = oneCandidate(label);
  assert.deepEqual(candidate, { candidate_state: "rejected" },
    `${label} must return only the generic rejection marker`);
  assert.doesNotMatch(JSON.stringify(candidate), /canary|rawArchivePath|rawLocation|privateNote/);
  assert.deepEqual(interpretPublicReadCandidate(candidate), { kind: "rejected" });
  assert.deepEqual(decidePublicReadResponse(interpretPublicReadCandidate(candidate)),
    { status: 503, cacheControl: "no-store" });
}
for (const label of ["claim-row-oversize", "publisher-row-oversize", "url-row-oversize"]) {
  const candidate = oneCandidate(label);
  assert.deepEqual(candidate, { candidate_state: "rejected" },
    `${label} must return only the generic rejection marker`);
  assert.doesNotMatch(JSON.stringify(candidate), /oversized-private/);
  assert.deepEqual(interpretPublicReadCandidate(candidate), { kind: "rejected" });
}
for (const label of ["source-title-changed", "source-title-withdrawn",
  "issue-title-changed", "issue-summary-changed", "issue-text-withdrawn",
  "period-label-changed", "period-withdrawn", "assertion-changed", "assertion-withdrawn"]) {
  const candidate = oneCandidate(label);
  assert.deepEqual(interpretPublicReadCandidate(candidate), { kind: "rejected" });
}
assert.equal(oneCandidate("source-title-withdrawn").sources[0].display_review.decision, "withdrawn");
assert.equal(oneCandidate("issue-text-withdrawn").publication_display_review.decision, "withdrawn");
assert.equal(oneCandidate("period-withdrawn").claims[0].period_review.decision, "withdrawn");
assert.equal(oneCandidate("assertion-withdrawn").claims[0].assertion_review.decision, "withdrawn");
assert.doesNotMatch(JSON.stringify(oneCandidate("source-title-withdrawn")), /review_reference|synthetic-withdrawal/);
assert.doesNotMatch(JSON.stringify(oneCandidate("issue-text-withdrawn")), /review_reference|synthetic-withdrawal/);
assert.doesNotMatch(JSON.stringify(oneCandidate("period-withdrawn")), /review_reference|synthetic-withdrawal/);
assert.doesNotMatch(JSON.stringify(oneCandidate("assertion-withdrawn")), /review_reference|synthetic-withdrawal/);
for (const label of ["wrong-country", "wrong-issue", "quoted-route", "coverage-paused"]) {
  assert.deepEqual(parsed.get(label), [], `${label} must not return a candidate`);
  assert.deepEqual(interpretPublicReadCandidate(null), { kind: "absent" });
  assert.deepEqual(decidePublicReadResponse(interpretPublicReadCandidate(null)),
    { status: 404, cacheControl: "no-store" });
}
for (const label of ["rights-revoked", "source-changed", "citation-missing"]) {
  assert.deepEqual(interpretPublicReadCandidate(oneCandidate(label)), { kind: "rejected" });
}
const remaining = query("select count(*) from terra_private.jurisdictions where id='TF-BRIDGE-SAMPLE';\n");
assert.equal(remaining, "0", "Synthetic transaction must leave no country row");
process.stdout.write("Parameterized local public-read rehearsal passed; fictional rows rolled back.\n");
