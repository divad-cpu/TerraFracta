\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Fictional pair, dispositions, work item and checkpoint stay in this rollback.
grant terra_reviewer, terra_operator, terra_collector to postgres;
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint)
values ('c1111111-1111-4111-8111-111111111111',
        'synthetic-validation', 'Synthetic', 'https://example.test/data'),
       ('c1222222-2222-4222-8222-222222222222',
        'other-validation', 'Synthetic', 'https://example.test/other');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values
  ('c2111111-1111-4111-8111-111111111111',
   'c1111111-1111-4111-8111-111111111111', 'metadata',
   'https://example.test/metadata', '2026-09-25 10:00:00+00', repeat('a',64)),
  ('c3111111-1111-4111-8111-111111111111',
   'c1111111-1111-4111-8111-111111111111', 'data',
   'https://example.test/data', '2026-09-25 10:00:01+00', repeat('b',64));
insert into terra_private.source_response_pairs
  (id, registration_id, attempt_key, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at)
values
  ('c4111111-1111-4111-8111-111111111111',
   'c1111111-1111-4111-8111-111111111111', 'synthetic-usable-pair',
   'c2111111-1111-4111-8111-111111111111',
   'c3111111-1111-4111-8111-111111111111',
   '2026-09-25 10:00:00+00', '2026-09-25 10:00:01+00'),
  ('c4222222-2222-4222-8222-222222222222',
   'c1111111-1111-4111-8111-111111111111', 'synthetic-held-pair',
   'c2111111-1111-4111-8111-111111111111',
   'c3111111-1111-4111-8111-111111111111',
   '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00'),
  ('c4333333-3333-4333-8333-333333333333',
   'c1111111-1111-4111-8111-111111111111', 'synthetic-unvalidated-pair',
   'c2111111-1111-4111-8111-111111111111',
   'c3111111-1111-4111-8111-111111111111',
   '2026-09-25 10:02:00+00', '2026-09-25 10:02:01+00');
insert into terra_private.source_work_items
  (source_version_id, registration_id)
values ('c3111111-1111-4111-8111-111111111111',
        'c1111111-1111-4111-8111-111111111111'),
       ('c2111111-1111-4111-8111-111111111111',
        'c1111111-1111-4111-8111-111111111111');

insert into terra_private.source_pair_validations
  (pair_id, registration_id, validation_state, assessed_at)
values ('c4111111-1111-4111-8111-111111111111',
        'c1111111-1111-4111-8111-111111111111', 'usable', now());
insert into terra_private.source_pair_validations
  (pair_id, registration_id, validation_state, reason_code, assessed_at)
values ('c4222222-2222-4222-8222-222222222222',
        'c1111111-1111-4111-8111-111111111111', 'held',
        'definition_changed', now());
select is((select count(*)::int from terra_private.source_pair_validations),
          2, 'usable and held private pair dispositions are distinct');

do $$
begin
  begin
    insert into terra_private.source_pair_validations
      (pair_id, registration_id, validation_state, assessed_at)
    values ('c4333333-3333-4333-8333-333333333333',
            'c1222222-2222-4222-8222-222222222222', 'usable', now());
    raise exception 'Validation crossed source registration';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'validation cannot attribute a pair to another registration');

do $$
begin
  begin
    update terra_private.source_pair_validations set reason_code=null
      where pair_id='c4222222-2222-4222-8222-222222222222';
    raise exception 'Held pair lost its reason';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'held pair requires a reason code');

do $$
begin
  begin
    update terra_private.source_pair_validations set reason_code='false_success'
      where pair_id='c4111111-1111-4111-8111-111111111111';
    raise exception 'Usable pair accepted a hold reason';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'usable pair cannot carry a hold reason');

do $$
begin
  begin
    insert into terra_private.source_checkpoints
      (registration_id, last_response_pair_id, last_source_version_id,
       last_successful_retrieved_at, last_attempted_at)
    values ('c1111111-1111-4111-8111-111111111111',
            'c4222222-2222-4222-8222-222222222222',
            'c3111111-1111-4111-8111-111111111111',
            '2026-09-25 10:01:01+00', '2026-09-25 10:01:01+00');
    raise exception 'Held pair advanced success checkpoint';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'held pair cannot advance the success checkpoint');

do $$
begin
  begin
    insert into terra_private.source_checkpoints
      (registration_id, last_response_pair_id, last_source_version_id,
       last_successful_retrieved_at, last_attempted_at)
    values ('c1111111-1111-4111-8111-111111111111',
            'c4111111-1111-4111-8111-111111111111',
            'c3111111-1111-4111-8111-111111111111',
            '2026-09-25 10:00:02+00', '2026-09-25 10:00:02+00');
    raise exception 'Checkpoint accepted an invented success time';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'success time must equal the selected pair data retrieval');

do $$
begin
  begin
    insert into terra_private.source_checkpoints
      (registration_id, last_response_pair_id, last_source_version_id,
       last_successful_retrieved_at, last_attempted_at)
    values ('c1111111-1111-4111-8111-111111111111',
            'c4111111-1111-4111-8111-111111111111',
            'c2111111-1111-4111-8111-111111111111',
            '2026-09-25 10:00:01+00', '2026-09-25 10:00:01+00');
    raise exception 'Checkpoint selected metadata as data';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'success version must equal the selected pair data version');

insert into terra_private.source_checkpoints
  (registration_id, last_response_pair_id, last_source_version_id,
   last_successful_retrieved_at, last_attempted_at)
values ('c1111111-1111-4111-8111-111111111111',
        'c4111111-1111-4111-8111-111111111111',
        'c3111111-1111-4111-8111-111111111111',
        '2026-09-25 10:00:01+00', '2026-09-25 10:00:01+00');
select is((select last_pair_state from terra_private.source_checkpoints),
          'usable', 'validated pair can advance a private success checkpoint');

do $$
begin
  begin
    update terra_private.source_pair_validations
      set validation_state='held', reason_code='late_hold'
      where pair_id='c4111111-1111-4111-8111-111111111111';
    raise exception 'Usable disposition drifted after checkpoint';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'referenced usable disposition cannot later drift');

select ok(not has_table_privilege('terra_collector',
          'terra_private.source_pair_validations', 'INSERT'),
          'collector has no validation writer grant');
select ok(not has_table_privilege('terra_operator',
          'terra_private.source_pair_validations', 'SELECT'),
          'operator has no detailed validation read grant');
select ok(not has_table_privilege('anon',
          'terra_private.source_pair_validations', 'SELECT'),
          'anonymous role has no direct validation read grant');
grant usage on schema terra_private to anon;
grant select on terra_private.source_pair_validations to anon;
set local role anon;
do $$
begin
  if (select count(*) from terra_private.source_pair_validations) <> 0 then
    raise exception 'Anonymous role saw private validation rows through RLS';
  end if;
end;
$$;
reset role;
select ok(true, 'RLS hides validations despite a rolled-back anonymous grant');
set local role terra_reviewer;
do $$
begin
  if (select count(*) from terra_private.source_pair_validations) <> 2 then
    raise exception 'Reviewer cannot read two private validation rows';
  end if;
end;
$$;
reset role;
select ok(true, 'reviewer can inspect validation outcomes');
select is((select count(*)::int from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid=c.relnamespace
           where n.nspname='terra_private' and c.relkind='r' and not c.relrowsecurity),
          0, 'every private table retains RLS');

select * from finish();
rollback;
