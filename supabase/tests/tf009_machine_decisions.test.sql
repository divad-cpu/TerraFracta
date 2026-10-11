\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);
-- Fixture-only defaults for the new nullable citation fields. Both ALTERs and
-- every fictional row roll back at the end; the actual schema has no default.
alter table terra_private.automatic_route_qualifications
  alter column public_citation_url set default 'https://example.org/fixed-table';
alter table terra_private.machine_candidate_decisions
  alter column public_citation_url set default 'https://example.org/fixed-table';

insert into terra_private.jurisdictions (id, display_name)
values ('TF-MACHINE-TEST', 'Fictional machine-decision place');
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint, registration_state,
   allow_fetch, allow_public_derived, fetch_enabled, reviewed_at)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-machine-source',
        'Fictional publisher', 'https://example.org/fixed-table', 'approved',
        true, true, true, '2026-09-29T11:00:00Z');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111', 'period-2025',
        'https://example.org/fixed-table', '2026-09-29T12:00:00Z', repeat('a', 64)),
       ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111', 'wrong-endpoint',
        'https://example.org/other-table', '2026-09-29T12:00:00Z', repeat('b', 64));
insert into terra_private.update_runs
  (id, request_key, request_fingerprint, jurisdiction_id, requested_by,
   mode, run_state, policy_version, created_at)
values ('44444444-4444-4444-8444-444444444444', 'machine-publish-run',
        repeat('c', 64), 'TF-MACHINE-TEST', 'runner:test',
        'publish_eligible', 'running', 'policy-v1', '2026-09-29T12:00:00Z'),
       ('55555555-5555-4555-8555-555555555555', 'machine-shadow-run',
        repeat('d', 64), 'TF-MACHINE-TEST', 'runner:test',
        'shadow', 'running', 'policy-v1', '2026-09-29T12:00:00Z'),
       ('66666666-6666-4666-8666-666666666666', 'machine-other-policy-run',
        repeat('e', 64), 'TF-MACHINE-TEST', 'runner:test',
        'publish_eligible', 'running', 'policy-v2', '2026-09-29T12:00:00Z');

insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at,
   qualification_expires_at, reviewed_sample_count, unresolved_sample_errors,
   semantic_contract_sha256)
values ('77777777-7777-4777-8777-777777777777',
        '11111111-1111-4111-8111-111111111111', 'structured_observation',
        1, 'qualified', 'https://example.org/fixed-table', 'policy-v1',
        'parser-v1', 'synthetic-qualification', 'test-owner', '2026-09-29T11:30:00Z',
        '2026-10-29T00:00:00Z', 3, 0, repeat('f', 64));
select is((select count(*)::int from terra_private.automatic_route_qualifications), 1,
          'one qualified private route is recorded');

select throws_ok($$insert into terra_private.automatic_route_qualifications
  (registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at)
values ('11111111-1111-4111-8111-111111111111', 'structured_observation',
        3, 'qualified', 'https://example.org/fixed-table', 'policy-v1',
        'parser-v1', 'skip', 'test-owner', '2026-09-29T11:40:00Z')$$,
  '23514', 'Qualification decisions must be consecutive and ordered',
  'qualification revision cannot skip');
select throws_ok($$insert into terra_private.automatic_route_qualifications
  (registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at)
values ('11111111-1111-4111-8111-111111111111', 'structured_observation',
        2, 'qualified', 'https://example.org/changed-table', 'policy-v1',
        'parser-v1', 'changed', 'test-owner', '2026-09-29T11:40:00Z')$$,
  '23514', 'Qualification endpoint differs from registration',
  'changed endpoint cannot reuse source qualification');
select throws_ok($$update terra_private.automatic_route_qualifications
  set parser_version='parser-v2' where id='77777777-7777-4777-8777-777777777777'$$,
  '23514', 'Automatic decision records are append-only',
  'a qualification cannot be silently rewritten');

insert into terra_private.machine_candidate_decisions
  (id, run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('88888888-8888-4888-8888-888888888888',
        '44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'period-2025:share',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{"source_version_current":true,"evidence_locator_verified":true,
          "identity_resolved":true,"fields_dates_units_verified":true,
          "semantics_qualified":true,"no_material_conflict":true,
          "public_snapshot_consistent":true,"expected_predecessor_current":true,
          "no_sensitive_data":true}'::jsonb,
        array['qualified_checks_passed'], 'runner:test', '2026-09-29T12:01:00Z');
select is((select disposition from terra_private.machine_candidate_decisions
            where id='88888888-8888-4888-8888-888888888888'), 'eligible',
          'eligible proposal is bound to the qualified source version and run');
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'false-check',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{"source_version_current":false}'::jsonb,
        array['qualified_checks_passed'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'new row for relation "machine_candidate_decisions" violates check constraint "eligible_machine_decision_v1_trace"',
  'a false or incomplete trace cannot be called eligible');
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'invented-extra-check',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{"source_version_current":true,"invented":true}'::jsonb,
        array['qualified_checks_passed'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'new row for relation "machine_candidate_decisions" violates check constraint "eligible_machine_decision_v1_trace"',
  'an invented check cannot widen the v1 trace');
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'duplicate-key',
        'eligible', repeat('b', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'Decision evidence does not match source, run or receipt',
  'wrong hash cannot be cited');
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '33333333-3333-4333-8333-333333333333', 'wrong-url',
        'eligible', repeat('b', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'Decision evidence does not match source, run or receipt',
  'wrong endpoint cannot be cited');
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('55555555-5555-4555-8555-555555555555',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'shadow-candidate',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'Current policy, source or run does not permit eligibility',
  'shadow run cannot mark a candidate eligible');
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'other-policy',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'Current policy, source or run does not permit eligibility',
  'different run policy cannot borrow qualification');

update terra_private.source_registrations set allow_public_derived=false
  where id='11111111-1111-4111-8111-111111111111';
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'rights-revoked',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'Current policy, source or run does not permit eligibility',
  'rights revocation blocks new eligibility');
update terra_private.source_registrations set allow_public_derived=true
  where id='11111111-1111-4111-8111-111111111111';

update terra_private.source_registrations
  set exact_endpoint='https://example.org/replaced-table'
  where id='11111111-1111-4111-8111-111111111111';
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'changed-registration-url',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'Current source route does not permit eligibility',
  'registration endpoint change invalidates old qualification');
update terra_private.source_registrations
  set exact_endpoint='https://example.org/fixed-table', fetch_enabled=false
  where id='11111111-1111-4111-8111-111111111111';
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'disabled-fetch',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:02:00Z')$$,
  '23514', 'Current source route does not permit eligibility',
  'disabled source fetch blocks new eligibility');
update terra_private.source_registrations set fetch_enabled=true
  where id='11111111-1111-4111-8111-111111111111';

insert into terra_private.automatic_route_qualifications
  (id, registration_id, change_class, revision, decision, exact_endpoint,
   policy_version, parser_version, decision_reference, decided_by, decided_at)
values ('99999999-9999-4999-8999-999999999999',
        '11111111-1111-4111-8111-111111111111', 'structured_observation',
        2, 'suspended', 'https://example.org/fixed-table', 'policy-v1',
        'parser-v1', 'synthetic-suspension', 'test-owner', '2026-09-29T12:02:00Z');
select throws_ok($$insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'stale-qualification',
        'eligible', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['test'], 'runner:test', '2026-09-29T12:03:00Z')$$,
  '23514', 'Current policy, source or run does not permit eligibility',
  'superseded qualification cannot mark new facts eligible');
insert into terra_private.machine_candidate_decisions
  (run_id, qualification_id, source_version_id, candidate_key,
   disposition, content_sha256, evidence_locator, semantic_contract_sha256,
   check_trace, reason_codes,
   machine_actor, decided_at)
values ('44444444-4444-4444-8444-444444444444',
        '77777777-7777-4777-8777-777777777777',
        '22222222-2222-4222-8222-222222222222', 'held-after-suspension',
        'held', repeat('a', 64), 'period=2025;measure=share', repeat('f', 64),
        '{}'::jsonb, array['qualification_suspended'],
        'runner:test', '2026-09-29T12:03:00Z');
select is((select disposition from terra_private.machine_candidate_decisions
            where candidate_key='held-after-suspension'), 'held',
          'held exception remains recordable after suspension');
select throws_ok($$update terra_private.machine_candidate_decisions
  set disposition='held' where id='88888888-8888-4888-8888-888888888888'$$,
  '23514', 'Automatic decision records are append-only',
  'machine decision cannot be rewritten');

select ok((select relrowsecurity from pg_catalog.pg_class
           where oid='terra_private.automatic_route_qualifications'::regclass),
          'qualification records have RLS');
select ok((select relrowsecurity from pg_catalog.pg_class
           where oid='terra_private.machine_candidate_decisions'::regclass),
          'machine decisions have RLS');
select ok(has_table_privilege('terra_reviewer',
          'terra_private.automatic_route_qualifications', 'SELECT'),
          'private reviewer may inspect qualifications');
select ok(has_table_privilege('terra_reviewer',
          'terra_private.machine_candidate_decisions', 'SELECT'),
          'private reviewer may inspect machine decisions');
select ok(not has_table_privilege('anon',
          'terra_private.automatic_route_qualifications', 'SELECT'),
          'anonymous client cannot inspect qualifications');
select ok(not has_table_privilege('anon',
          'terra_private.machine_candidate_decisions', 'SELECT'),
          'anonymous client cannot inspect machine decisions');
select ok(not has_table_privilege('terra_issue_reader',
          'terra_private.automatic_route_qualifications', 'SELECT'),
          'public candidate reader cannot inspect qualifications');
select ok(not has_table_privilege('terra_issue_reader',
          'terra_private.machine_candidate_decisions', 'SELECT'),
          'public candidate reader cannot inspect machine decisions');
select ok(not has_table_privilege('terra_collector',
          'terra_private.automatic_route_qualifications', 'INSERT'),
          'collector cannot create source qualifications');
select ok(not has_table_privilege('terra_collector',
          'terra_private.machine_candidate_decisions', 'INSERT'),
          'collector cannot create machine decisions');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.check_machine_candidate_decision_insert()', 'EXECUTE'),
          'public candidate reader cannot call private decision guard');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.check_machine_current_route_insert()', 'EXECUTE'),
          'public candidate reader cannot call current-route guard');
select * from finish();
rollback;
