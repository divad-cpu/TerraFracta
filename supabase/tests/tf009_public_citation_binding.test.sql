\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into terra_private.jurisdictions (id, display_name)
values ('TF-CITATION-DRAFT', 'Fictional public citation place');
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint, registration_state,
   allow_fetch, allow_public_derived, fetch_enabled, reviewed_at)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-citation-source',
        'Fictional publisher', 'https://example.org/api/table', 'approved',
        true, true, true, '2026-09-30T08:00:00Z');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111', 'fictional-period',
        'https://example.org/api/table', '2026-09-30T08:30:00Z', repeat('a', 64));
insert into terra_private.update_runs
  (id, request_key, request_fingerprint, jurisdiction_id, requested_by,
   mode, run_state, policy_version, created_at)
values ('33333333-3333-4333-8333-333333333333', 'fictional-citation-run',
        repeat('b', 64), 'TF-CITATION-DRAFT', 'runner:test',
        'publish_eligible', 'running', 'policy-v1', '2026-09-30T08:30:00Z');

create function pg_temp.try_citation_decision(
  qualification uuid, candidate text, citation text,
  result_state text default 'eligible'
)
returns void language plpgsql as $test$
begin
  insert into terra_private.machine_candidate_decisions
    (run_id, qualification_id, source_version_id, candidate_key,
     disposition, content_sha256, evidence_locator, semantic_contract_sha256,
     public_citation_url, check_trace, reason_codes, machine_actor, decided_at)
  values ('33333333-3333-4333-8333-333333333333', qualification,
          '22222222-2222-4222-8222-222222222222', candidate,
          result_state, repeat('a', 64), 'period=2025;measure=share',
          repeat('c', 64), citation,
          '{"source_version_current":true,"evidence_locator_verified":true,
            "identity_resolved":true,"fields_dates_units_verified":true,
            "semantics_qualified":true,"no_material_conflict":true,
            "public_snapshot_consistent":true,"expected_predecessor_current":true,
            "no_sensitive_data":true}'::jsonb,
          array['qualified_checks_passed'], 'runner:test', '2026-09-30T08:31:00Z');
end;
$test$;
create function pg_temp.try_citation_qualification(
  qualification uuid, rev integer, citation text
)
returns void language plpgsql as $test$
begin
  insert into terra_private.automatic_route_qualifications
    (id, registration_id, change_class, revision, decision, exact_endpoint,
     policy_version, parser_version, decision_reference, decided_by, decided_at,
     qualification_expires_at, reviewed_sample_count, unresolved_sample_errors,
     semantic_contract_sha256, public_citation_url)
  values (qualification, '11111111-1111-4111-8111-111111111111',
          'structured_observation', rev, 'qualified',
          'https://example.org/api/table', 'policy-v1', 'parser-v1',
          'fictional-review', 'test-owner', '2026-09-30T08:15:00Z',
          '2026-10-30T00:00:00Z', 3, 0, repeat('c', 64), citation);
end;
$test$;

select lives_ok($$select pg_temp.try_citation_qualification(
  '44444444-4444-4444-8444-444444444444', 1, null)$$,
  'historical qualification may remain without a public target');
select throws_ok($$select pg_temp.try_citation_decision(
  '44444444-4444-4444-8444-444444444444', 'missing-target', null)$$,
  '23514', 'Selected public citation differs from qualification',
  'missing qualified target blocks eligibility even when both links are null');
select lives_ok($$select pg_temp.try_citation_decision(
  '44444444-4444-4444-8444-444444444444', 'held-without-target', null, 'held')$$,
  'a missing citation does not prevent recording a held exception');
select lives_ok($$select pg_temp.try_citation_qualification(
  '55555555-5555-4555-8555-555555555555', 2,
  'https://example.org/public/table')$$,
  'reviewed public target can differ from exact retrieval endpoint');
select lives_ok($$select pg_temp.try_citation_decision(
  '55555555-5555-4555-8555-555555555555', 'exact-target',
  'https://example.org/public/table')$$,
  'exact qualified public target permits an otherwise eligible decision');
select throws_ok($$select pg_temp.try_citation_decision(
  '55555555-5555-4555-8555-555555555555', 'missing-selected', null)$$,
  '23514', 'Selected public citation differs from qualification',
  'an eligible decision must name the selected public target');
select throws_ok($$select pg_temp.try_citation_decision(
  '55555555-5555-4555-8555-555555555555', 'retrieval-substitution',
  'https://example.org/api/table')$$,
  '23514', 'Selected public citation differs from qualification',
  'machine endpoint cannot silently replace reviewed public target');
select throws_ok($$select pg_temp.try_citation_decision(
  '55555555-5555-4555-8555-555555555555', 'other-target',
  'https://example.org/public/other')$$,
  '23514', 'Selected public citation differs from qualification',
  'a different reader target is held');
select throws_ok($$select pg_temp.try_citation_decision(
  '55555555-5555-4555-8555-555555555555', 'normalized-target',
  'https://example.org/public/table/')$$,
  '23514', 'Selected public citation differs from qualification',
  'trailing-slash normalization cannot change the accepted target');
select throws_ok($$update terra_private.automatic_route_qualifications
  set public_citation_url='https://example.org/replacement'
  where id='55555555-5555-4555-8555-555555555555'$$,
  '23514', 'Automatic decision records are append-only',
  'accepted citation cannot be changed inside an existing qualification');
select throws_ok($$update terra_private.machine_candidate_decisions
  set public_citation_url='https://example.org/replacement'
  where candidate_key='exact-target'$$,
  '23514', 'Automatic decision records are append-only',
  'selected decision citation is immutable');
select throws_ok($$select pg_temp.try_citation_qualification(
  '66666666-6666-4666-8666-666666666666', 3,
  'http://example.org/public/table')$$,
  '23514', 'new row for relation "automatic_route_qualifications" violates check constraint "qualification_public_citation_shape"',
  'basic qualified target shape refuses HTTP');
select throws_ok($$select pg_temp.try_citation_qualification(
  '66666666-6666-4666-8666-666666666666', 3,
  'https://user:secret@example.org/public/table')$$,
  '23514', 'new row for relation "automatic_route_qualifications" violates check constraint "qualification_public_citation_shape"',
  'basic qualified target shape refuses embedded credentials');
select throws_ok($$select pg_temp.try_citation_qualification(
  '66666666-6666-4666-8666-666666666666', 3,
  'https://example.org/public/table#different')$$,
  '23514', 'new row for relation "automatic_route_qualifications" violates check constraint "qualification_public_citation_shape"',
  'fragments cannot qualify as canonical targets');
select ok(not has_function_privilege('terra_collector',
  'terra_private.check_machine_public_citation_insert()', 'EXECUTE'),
  'collector has no guard execution grant');
select ok(not has_function_privilege('terra_issue_reader',
  'terra_private.check_machine_public_citation_insert()', 'EXECUTE'),
  'reader has no guard execution grant');
select ok(not has_table_privilege('terra_collector',
  'terra_private.automatic_route_qualifications', 'INSERT'),
  'collector still cannot approve a public target');
select ok(not has_table_privilege('anon',
  'terra_private.machine_candidate_decisions', 'SELECT'),
  'anonymous clients cannot inspect decision records');
select * from finish();

rollback;
