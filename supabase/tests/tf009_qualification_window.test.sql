\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
-- Fixture-only targets keep the existing window negatives isolated. These
-- defaults roll back and never become runtime defaults on either table.
alter table terra_private.automatic_route_qualifications
  alter column public_citation_url set default 'https://example.org/scoped-table';
alter table terra_private.machine_candidate_decisions
  alter column public_citation_url set default 'https://example.org/scoped-table';

insert into terra_private.jurisdictions (id, display_name)
values ('TF-QUAL-WINDOW', 'Fictional qualification window place');
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint, registration_state,
   allow_fetch, allow_public_derived, fetch_enabled, reviewed_at)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-window-source',
        'Fictional publisher', 'https://example.org/scoped-table', 'approved',
        true, true, true, '2026-09-29T11:00:00Z');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111', 'fictional-item',
        'https://example.org/scoped-table', '2026-09-29T12:00:00Z', repeat('a', 64));
insert into terra_private.update_runs
  (id, request_key, request_fingerprint, jurisdiction_id, requested_by,
   mode, run_state, policy_version, created_at)
values ('33333333-3333-4333-8333-333333333333', 'fictional-window-run',
        repeat('b', 64), 'TF-QUAL-WINDOW', 'runner:test',
        'publish_eligible', 'running', 'policy-v1', '2026-09-29T12:00:00Z');

create function pg_temp.try_eligible(
  qualification uuid, candidate text,
  contract_sha256 text default repeat('c', 64)
)
returns void language plpgsql as $test$
begin
  insert into terra_private.machine_candidate_decisions
    (run_id, qualification_id, source_version_id, candidate_key,
     disposition, content_sha256, evidence_locator, semantic_contract_sha256,
     check_trace,
     reason_codes, machine_actor, decided_at)
  values ('33333333-3333-4333-8333-333333333333', qualification,
          '22222222-2222-4222-8222-222222222222', candidate,
          'eligible', repeat('a', 64), 'period=2025;measure=share',
          contract_sha256,
          '{"source_version_current":true,"evidence_locator_verified":true,
            "identity_resolved":true,"fields_dates_units_verified":true,
            "semantics_qualified":true,"no_material_conflict":true,
            "public_snapshot_consistent":true,"expected_predecessor_current":true,
            "no_sensitive_data":true}'::jsonb,
          array['qualified_checks_passed'], 'runner:test', '2026-09-29T12:01:00Z');
end;
$test$;

insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at,
   qualification_expires_at, reviewed_sample_count, unresolved_sample_errors,
   semantic_contract_sha256)
values ('44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111', 'structured_observation',
        1, 'qualified', 'https://example.org/scoped-table', 'policy-v1',
        'parser-v1', 'fictional-review-1', 'test-owner', '2026-09-29T11:30:00Z',
        '2026-09-29T12:01:00Z', 3, 0, repeat('c', 64));
select throws_ok($$select pg_temp.try_eligible('44444444-4444-4444-8444-444444444444', 'expired')$$,
  '23514', 'Qualification review window or sample basis is missing',
  'expiry at the decision instant blocks eligibility');
insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, check_trace,
   reason_codes, machine_actor, decided_at)
values ('33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        '22222222-2222-4222-8222-222222222222', 'held-after-expiry',
        'held', repeat('a', 64), 'period=2025;measure=share',
        '{}'::jsonb, array['qualification_expired'],
        'runner:test', '2026-09-29T12:01:00Z');
select is((select disposition from terra_private.machine_candidate_decisions
           where candidate_key='held-after-expiry'), 'held',
          'an expired route can still record its held exception');

insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at,
   qualification_expires_at, reviewed_sample_count, unresolved_sample_errors,
   semantic_contract_sha256)
values ('55555555-5555-4555-8555-555555555555',
        '11111111-1111-4111-8111-111111111111', 'structured_observation',
        2, 'qualified', 'https://example.org/scoped-table', 'policy-v1',
        'parser-v1', 'fictional-review-2', 'test-owner', '2026-09-29T11:31:00Z',
        '2026-10-29T00:00:00Z', 2, 0, repeat('c', 64));
select throws_ok($$select pg_temp.try_eligible('55555555-5555-4555-8555-555555555555', 'too-few-samples')$$,
  '23514', 'Qualification review window or sample basis is missing',
  'fewer than three recorded samples blocks eligibility');

insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at,
   qualification_expires_at, reviewed_sample_count, unresolved_sample_errors,
   semantic_contract_sha256)
values ('66666666-6666-4666-8666-666666666666',
        '11111111-1111-4111-8111-111111111111', 'structured_observation',
        3, 'qualified', 'https://example.org/scoped-table', 'policy-v1',
        'parser-v1', 'fictional-review-3', 'test-owner', '2026-09-29T11:32:00Z',
        '2026-10-29T00:00:00Z', 3, 1, repeat('c', 64));
select throws_ok($$select pg_temp.try_eligible('66666666-6666-4666-8666-666666666666', 'sample-error')$$,
  '23514', 'Qualification review window or sample basis is missing',
  'an unresolved sample error blocks eligibility');

insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at,
   qualification_expires_at, reviewed_sample_count, unresolved_sample_errors)
values ('77777777-7777-4777-8777-777777777777',
        '11111111-1111-4111-8111-111111111111', 'structured_observation',
        4, 'qualified', 'https://example.org/scoped-table', 'policy-v1',
        'parser-v1', 'fictional-review-4', 'test-owner', '2026-09-29T11:33:00Z',
        '2026-10-29T00:00:00Z', 3, 0);
select throws_ok($$select pg_temp.try_eligible('77777777-7777-4777-8777-777777777777', 'missing-contract')$$,
  '23514', 'Qualification review window or sample basis is missing',
  'an absent semantic contract fingerprint blocks eligibility');

insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at,
   qualification_expires_at, reviewed_sample_count, unresolved_sample_errors,
   semantic_contract_sha256)
values ('88888888-8888-4888-8888-888888888888',
        '11111111-1111-4111-8111-111111111111', 'structured_observation',
        5, 'qualified', 'https://example.org/scoped-table', 'policy-v1',
        'parser-v1', 'fictional-review-5', 'test-owner', '2026-09-29T11:34:00Z',
        '2026-10-29T00:00:00Z', 3, 0, repeat('c', 64));
select lives_ok($$select pg_temp.try_eligible('88888888-8888-4888-8888-888888888888', 'valid-window')$$,
  'a current sampled route can record a guarded eligible decision');
select throws_ok($$select pg_temp.try_eligible(
  '88888888-8888-4888-8888-888888888888', 'changed-contract', repeat('d', 64))$$,
  '23514', 'Qualification review window or sample basis is missing',
  'an observation using a different semantic contract is held');
select ok(not has_function_privilege('terra_collector',
          'terra_private.check_machine_qualification_window_insert()', 'EXECUTE'),
          'collector cannot invoke the private qualification guard');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.check_machine_qualification_window_insert()', 'EXECUTE'),
          'public reader cannot invoke the private qualification guard');
select * from finish();
rollback;
