import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fictionalPublicationDraftSchema } from "../src/fictional-publication-draft.ts";
import { interpretPublicReadCandidate } from "../src/public-read-outcome.ts";

// Fixed local owner-driven integration rehearsal. No connection string, file
// argument, commit option, real source, application role or live activation.
const container = "supabase_db_terrafracta-local";
assert.ok(process.argv.length === 2 || (process.argv.length === 3 &&
  ["--citation-reader-draft", "--citation-reader-active"].includes(process.argv[2])),
  "Only the fixed citation-reader draft or authorized active reader is supported");
const draftOverlay = process.argv[2] === "--citation-reader-draft";
const activeBinding = process.argv[2] === "--citation-reader-active";
const useBinding = draftOverlay || activeBinding;
function command(executable, args, input, maxBuffer = 512 * 1024) {
  const result = spawnSync(executable, args, {
    input, encoding: "utf8", timeout: 30_000, maxBuffer, shell: false,
  });
  if (result.error || result.status !== 0) {
    const sqlError = result.stderr?.split("\n").find((line) => line.startsWith("ERROR:"));
    throw new Error(`Fixed local activation rehearsal failed at ${executable}${sqlError ? `: ${sqlError.slice(0, 240)}` : ""}`);
  }
  return result.stdout.trim();
}
const ports = JSON.parse(command("docker", ["inspect", "--format",
  "{{json .NetworkSettings.Ports}}", container]));
assert.deepEqual(ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "65432" }],
  "The fixed development database must be bound only to the expected loopback port");
const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
  "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
const query = (sql) => command("docker", args, sql);
const baselineSql = `select jsonb_build_object(
  'migrations', (select count(*) from supabase_migrations.schema_migrations),
  'jurisdictions', (select count(*) from terra_private.jurisdictions),
  'dossiers', (select count(*) from terra_private.issue_dossiers),
  'versions', (select count(*) from terra_private.source_versions),
  'qualifications', (select count(*) from terra_private.automatic_route_qualifications),
  'decisions', (select count(*) from terra_private.machine_candidate_decisions),
  'claims', (select count(*) from terra_private.claims),
  'evidence', (select count(*) from terra_private.claim_evidence),
  'publications', (select count(*) from terra_private.issue_publications),
  'citations', (select count(*) from terra_private.issue_publication_citations),
  'heads', (select count(*) from terra_private.issue_heads),
  'runs', (select count(*) from terra_private.update_runs),
  'sourceReviews', (select count(*) from terra_private.source_display_reviews),
  'textReviews', (select count(*) from terra_private.issue_text_reviews),
  'periodReviews', (select count(*) from terra_private.claim_period_reviews),
  'assertionReviews', (select count(*) from terra_private.claim_assertion_reviews),
  'readerMember', pg_has_role('postgres','terra_issue_reader','MEMBER'),
  'bindingTable', to_regclass('terra_private.issue_publication_machine_bindings') is not null,
  'readerOid', to_regprocedure('terra_private.read_issue_candidate(text,text)')::oid);
`;
const before = JSON.parse(query(baselineSql));
assert.equal(before.migrations, draftOverlay ? 25 : 27,
  "Draft overlay requires the preserved 25 baseline; active rehearsal requires authorized migration 27");
assert.equal(before.bindingTable, !draftOverlay,
  "Reader binding presence must match the selected fixed rehearsal mode");
const bindingCount = before.bindingTable
  ? Number(query("select count(*) from terra_private.issue_publication_machine_bindings;")) : null;
const payload = JSON.parse(command("python3", ["-m", useBinding ? "scripts.fictional_citation_reader_payload" : "scripts.fictional_activation_payload"], undefined, 64 * 1024));
assert.equal(payload.fixtureKind, "rollback_only_machine_activation");
const draft = fictionalPublicationDraftSchema.parse(payload.draft);
assert.equal(draft.observation.value, "27.4");
assert.equal(payload.retrievalUrl, "https://example.org/fictional-table/data?format=json");
assert.equal(draft.decision.publicCitationUrl, useBinding ? "https://example.org/fictional-table" : payload.retrievalUrl);
assert.deepEqual(payload.reasonCodes, ["qualified_checks_passed"]);
assert.equal(Object.keys(payload.checkTrace).length, 9);
assert.ok(Object.values(payload.checkTrace).every((value) => value === true));
const fixture = readFileSync(new URL("../tests/fixtures/tf009_machine_activation_bridge.sql", import.meta.url), "utf8");
assert.equal(fixture.split("-- TF_ACTIVATION_INPUT").length, 2);
// SQL string quoting, not shell interpolation. The subprocess has no shell.
const quoted = `'${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb`;
let seed = fixture.replace("-- TF_ACTIVATION_INPUT", `insert into activation_input values (${quoted});`);
if (draftOverlay) {
  const overlay = readFileSync(new URL("../research/pending/TF009_public_citation_reader_binding.sql", import.meta.url), "utf8");
  const outsideBodies = overlay.replace(/--[^\n]*/g, "").replace(/(\$[A-Za-z_0-9]*\$)[\s\S]*?\1/g, "''");
  assert.ok(!/(?:^|;)\s*(?:begin|commit|rollback|abort|end|prepare\s+transaction)\b/im.test(outsideBodies), "The fixed overlay cannot control its transaction");
  assert.ok(!/^\s*\\/m.test(outsideBodies), "The fixed overlay cannot issue psql commands");
  seed = seed.replace("begin;", `begin;\n${overlay}`);
}
if (useBinding) {
  assert.equal(seed.split("or evidence->>'url' is distinct from v.source_url").length, 2);
  seed = seed.replace("or evidence->>'url' is distinct from v.source_url", "");
  assert.equal(seed.split("-- TF_MACHINE_BINDING_INSERT").length, 2);
  seed = seed.replace("-- TF_MACHINE_BINDING_INSERT", `insert into terra_private.issue_publication_machine_bindings
    (publication_id,claim_id,decision_id) values (pub_id,fixture_claim_id,d.id);`);
}
const cases = [
  ["accepted", "", "pg_temp.try_fictional_activation(payload)", "activated"],
  ["same-request-replay", "select pg_temp.try_fictional_activation(payload) from activation_input;",
    "pg_temp.try_fictional_activation(payload)", "already_activated"],
  ["replay-payload-changed", `select pg_temp.try_fictional_activation(payload) from activation_input;
     update activation_input set payload=jsonb_set(payload,'{requestKey}','"substituted-request"');`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["rights-revoked", "update terra_private.source_registrations set allow_public_derived=false where source_key='fictional-source';",
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["fetch-disabled", "update terra_private.source_registrations set fetch_enabled=false where source_key='fictional-source';",
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["qualification-suspended", `insert into terra_private.automatic_route_qualifications
    (registration_id, change_class, revision, decision, exact_endpoint, policy_version,
     parser_version, decision_reference, decided_by, decided_at)
    select registration_id, change_class, 2, 'suspended', exact_endpoint, policy_version,
      parser_version, 'fictional-suspension', 'fictional-test-owner', '2026-09-28T06:01:30Z'
    from terra_private.automatic_route_qualifications where revision=1;`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["qualification-expired", "", "pg_temp.try_fictional_activation(payload,null,'2027-01-01T00:00:00Z')", "held"],
  ["stale-expected-head", "", "pg_temp.try_fictional_activation(payload,'99999999-9999-4999-8999-999999999999')", "held"],
  ["receipt-hash-changed", "update terra_private.source_versions set content_sha256=repeat('f',64) where item_key='fictional-period-2025';",
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["invented-locator", `update activation_input set payload=jsonb_set(payload,
    '{draft,publication,snapshot,claims,0,evidence,0,locator}','"invented-location"');`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["wording-changed", `update activation_input set payload=jsonb_set(payload,
    '{draft,publication,snapshot,claims,0,assertion}','"A made-up stronger conclusion."');`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["source-title-withdrawn", `insert into terra_private.source_display_reviews
     (source_version_id,revision,decision,reviewed_at,review_reference)
     select (payload #>> '{draft,decision,sourceVersionId}')::uuid,2,'withdrawn',
       '2026-09-28T06:01:30Z','fictional-withdrawal' from activation_input;`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["route-paused", "update terra_private.jurisdictions set coverage_state='maintenance_paused' where id='TF-ACTIVATION-FICTIONAL';",
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["source-newer-version", `insert into terra_private.source_versions
     (id,registration_id,item_key,source_url,retrieved_at,content_sha256)
     select '99999999-9999-4999-8999-999999999999',registration_id,item_key,source_url,
       '2026-09-28T06:01:30Z',repeat('f',64) from terra_private.source_versions
     where item_key='fictional-period-2025';`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["private-snapshot-field", `update activation_input set payload=jsonb_set(payload,
     '{draft,publication,snapshot,privateNote}','"fictional-private-canary"');`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["null-activation-time", "", "pg_temp.try_fictional_activation(payload,null,null)", "held"],
  ["selected-parser-changed", `update activation_input set payload=jsonb_set(payload,
     '{parserVersion}','"unqualified-parser-v2"');`,
    "pg_temp.try_fictional_activation(payload)", "held"],
  ["late-write-failure", "", "pg_temp.try_fictional_activation(payload,null,'2026-09-28T06:02:00Z',true)", "held"],
];
if (useBinding) cases.push(["unbound-public-target", "", "pg_temp.try_fictional_activation(payload)", "activated", "rejected"]);
const stateSql = `select jsonb_build_object(
 'publicationCount',(select count(*) from terra_private.issue_publications
   where issue_id=(payload #>> '{draft,publication,issueId}')::uuid),
 'claimCount',(select count(*) from terra_private.claims
   where issue_id=(payload #>> '{draft,publication,issueId}')::uuid),
 'head',(select current_publication_id from terra_private.issue_heads
   where issue_id=(payload #>> '{draft,publication,issueId}')::uuid),
 'receiptCount',(select count(*) from activation_receipts),
 'runState',(select run_state from terra_private.update_runs where id=(payload->>'runId')::uuid),
 'commitState',(select commit_state from terra_private.update_runs where id=(payload->>'runId')::uuid),
 'visibilityState',(select visibility_state from terra_private.update_runs where id=(payload->>'runId')::uuid))
 from activation_input;`;
const scenarioSql = cases.map(([label, setup, call]) => String.raw`
\echo CASE:${label}
savepoint one_case;
${setup}
\echo RESULT
select ${call} from activation_input;
\echo STATE
${stateSql}
\echo READ
${label === "unbound-public-target" ? "" : "set local role terra_issue_reader;"}
select coalesce(terra_private.${label === "unbound-public-target" ? "read_issue_candidate_without_machine_bindings" : "read_issue_candidate"}('fictional-country','fictional-share'), 'null'::jsonb);
reset role;
rollback to one_case;
release savepoint one_case;`).join("\n");
let output;
try {
  const draftTests = useBinding ? readFileSync(new URL("../research/pending/TF009_public_citation_reader_binding.test.sql", import.meta.url), "utf8") : "";
  output = query(`${seed}\n${scenarioSql}\n${useBinding ? `\\echo DRAFT_TAP\n${draftTests}\n\\echo DRAFT_TAP_END` : ""}\nrollback;`);
} finally {
  assert.deepEqual(JSON.parse(query(baselineSql)), before,
    "The transaction must restore database state even when fixture execution fails");
}
if (useBinding) {
  const sections = output.split("DRAFT_TAP\n");
  assert.equal(sections.length, 2);
  const tap = sections[1].split("DRAFT_TAP_END")[0];
  assert.match(tap, /^1\.\.27$/m);
  assert.equal(tap.split("\n").filter((line) => /^ok [0-9]+\b/.test(line)).length, 27);
  assert.doesNotMatch(tap, /^not ok\b|^# (?:Looks like|Failed)/m);
  output = sections[0].trim();
}
const observations = new Map();
let current;
let section;
for (const line of output.split("\n")) {
  if (line.startsWith("CASE:")) {
    current = line.slice(5);
    observations.set(current, { RESULT: [], STATE: [], READ: [] });
    section = undefined;
  } else if (["RESULT", "STATE", "READ"].includes(line)) {
    section = line;
  } else if (section) {
    observations.get(current)[section].push(line);
  }
}
assert.deepEqual([...observations.keys()], cases.map(([label]) => label));
for (const [label, , , expected, expectedRead] of cases) {
  const observed = observations.get(label);
  assert.equal(observed.RESULT.length, 1, label);
  assert.equal(observed.STATE.length, 1, label);
  assert.equal(observed.READ.length, 1, label);
  assert.equal(JSON.parse(observed.RESULT[0]).status, expected, label);
  const state = JSON.parse(observed.STATE[0]);
  const activated = ["accepted", "same-request-replay", "replay-payload-changed", "unbound-public-target"].includes(label);
  assert.equal(state.publicationCount, activated ? 1 : 0, label);
  assert.equal(state.claimCount, activated ? 1 : 0, label);
  assert.equal(state.receiptCount, activated ? 1 : 0, label);
  assert.equal(state.head, activated ? draft.publication.id : null, label);
  assert.equal(state.runState, activated ? "completed" : "running", label);
  assert.equal(state.commitState, activated ? "committed" : "none", label);
  assert.equal(state.visibilityState, activated ? "pending" : "not_required", label);
  const outcome = interpretPublicReadCandidate(observed.READ[0] === "" ? null : JSON.parse(observed.READ[0]));
  assert.equal(outcome.kind, expectedRead ?? (activated ? "issue" : "absent"), label);
  if (outcome.kind === "issue") {
    assert.equal(outcome.issue.publicationId, draft.publication.id, label);
    assert.equal(outcome.issue.claims[0].assertion, draft.publication.snapshot.claims[0].assertion, label);
  }
}
assert.deepEqual(JSON.parse(query(baselineSql)), before,
  "All rows, migration records and temporary reader membership must be restored by rollback");
if (before.bindingTable) assert.equal(
  Number(query("select count(*) from terra_private.issue_publication_machine_bindings;")),
  bindingCount, "Existing binding rows must be restored by rollback");
console.log(`Passed ${cases.length} fixed fictional activation/read scenarios${useBinding ? ` and 27 pgTAP checks with the ${activeBinding ? "authorized active" : "rollback-only draft"} citation reader` : ""}; database state restored. Visibility remains a local observed read, not a durable verified receipt.`);
