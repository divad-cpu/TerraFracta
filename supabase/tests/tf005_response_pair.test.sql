\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- These records and test-only grants are rolled back.
grant terra_reviewer, terra_operator, terra_collector to postgres;
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint)
values
  ('c1111111-1111-4111-8111-111111111111', 'synthetic-pair-a', 'Synthetic', 'https://example.test/a'),
  ('c2222222-2222-4222-8222-222222222222', 'synthetic-pair-b', 'Synthetic', 'https://example.test/b');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values
  ('d1111111-1111-4111-8111-111111111111',
   'c1111111-1111-4111-8111-111111111111',
   'metadata', 'https://example.test/a/metadata', '2026-09-25 10:00:00+00', repeat('a', 64)),
  ('d2222222-2222-4222-8222-222222222222',
   'c1111111-1111-4111-8111-111111111111',
   'data', 'https://example.test/a/data', '2026-09-25 10:00:01+00', repeat('b', 64)),
  ('d3333333-3333-4333-8333-333333333333',
   'c2222222-2222-4222-8222-222222222222',
   'metadata', 'https://example.test/b/metadata', '2026-09-25 10:00:00+00', repeat('c', 64));

insert into terra_private.source_response_pairs
  (registration_id, attempt_key, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at)
values
  ('c1111111-1111-4111-8111-111111111111', 'synthetic-attempt-1',
   'd1111111-1111-4111-8111-111111111111',
   'd2222222-2222-4222-8222-222222222222',
   '2026-09-25 10:00:00+00', '2026-09-25 10:00:01+00');
select is((select count(*)::integer from terra_private.source_response_pairs),
          1, 'one pair binds both source versions');

do $$
begin
  begin
    insert into terra_private.source_response_pairs
      (registration_id, attempt_key, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at)
    values
      ('c1111111-1111-4111-8111-111111111111', 'synthetic-cross-source',
       'd3333333-3333-4333-8333-333333333333',
       'd2222222-2222-4222-8222-222222222222',
       now(), now());
    raise exception 'Pair crossed source registrations';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'pair cannot bind metadata from another registration');

do $$
begin
  begin
    insert into terra_private.source_response_pairs
      (registration_id, attempt_key, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at)
    values
      ('c1111111-1111-4111-8111-111111111111', 'synthetic-same-version',
       'd1111111-1111-4111-8111-111111111111',
       'd1111111-1111-4111-8111-111111111111', now(), now());
    raise exception 'Pair reused the same version twice';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'metadata and data references must differ');

do $$
begin
  begin
    insert into terra_private.source_response_pairs
      (registration_id, attempt_key, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at)
    values
      ('c1111111-1111-4111-8111-111111111111', 'synthetic-reversed-time',
       'd1111111-1111-4111-8111-111111111111',
       'd2222222-2222-4222-8222-222222222222',
       '2026-09-25 10:00:02+00', '2026-09-25 10:00:01+00');
    raise exception 'Pair accepted reversed retrieval times';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'metadata retrieval must not follow data retrieval');

do $$
begin
  begin
    insert into terra_private.source_response_pairs
      (registration_id, attempt_key, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at)
    values
      ('c1111111-1111-4111-8111-111111111111', 'synthetic-overlong-pair',
       'd1111111-1111-4111-8111-111111111111',
       'd2222222-2222-4222-8222-222222222222',
       '2026-09-25 10:00:00+00', '2026-09-25 10:05:01+00');
    raise exception 'Pair accepted a retrieval span longer than five minutes';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'pair rejects a retrieval span beyond five minutes');

insert into terra_private.source_response_pairs
  (registration_id, attempt_key, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at)
values
  ('c1111111-1111-4111-8111-111111111111', 'synthetic-five-minute-boundary',
   'd1111111-1111-4111-8111-111111111111',
   'd2222222-2222-4222-8222-222222222222',
   '2026-09-25 10:00:00+00', '2026-09-25 10:05:00+00');
select is(
  (select count(*)::integer from terra_private.source_response_pairs
   where attempt_key = 'synthetic-five-minute-boundary'),
  1, 'exact five-minute retrieval span remains valid'
);
delete from terra_private.source_response_pairs
  where attempt_key = 'synthetic-five-minute-boundary';

do $$
begin
  begin
    insert into terra_private.source_response_pairs
      (registration_id, attempt_key, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at)
    values
      ('c1111111-1111-4111-8111-111111111111', 'synthetic-attempt-1',
       'd1111111-1111-4111-8111-111111111111',
       'd2222222-2222-4222-8222-222222222222', now(), now());
    raise exception 'Pair accepted a duplicate attempt key';
  exception when unique_violation then null;
  end;
end;
$$;
select ok(true, 'one attempt key cannot identify two pairs');

insert into terra_private.source_response_pairs
  (registration_id, attempt_key, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at)
values
  ('c1111111-1111-4111-8111-111111111111', 'synthetic-attempt-2',
   'd1111111-1111-4111-8111-111111111111',
   'd2222222-2222-4222-8222-222222222222',
   '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00');
select is((select count(*)::integer from terra_private.source_response_pairs),
          2, 'repeated same-body pair can retain a separate attempt identity');

select ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role'),
                        ('terra_collector'), ('terra_operator')) excluded(role_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) operation(privilege_name)
    where has_table_privilege(excluded.role_name,
                              'terra_private.source_response_pairs',
                              operation.privilege_name)
  ), 'excluded roles have no direct pair-table privilege'
);

grant usage on schema terra_private to anon;
grant select on terra_private.source_response_pairs to anon;
set local role anon;
do $$
declare visible_pairs integer;
begin
  select count(*) into visible_pairs from terra_private.source_response_pairs;
  if visible_pairs <> 0 then
    raise exception 'Anonymous role saw % private pairs through RLS', visible_pairs;
  end if;
end;
$$;
reset role;
select ok(true, 'RLS hides pairs even after an accidental anonymous SELECT grant');

set local role terra_reviewer;
do $$
declare visible_pairs integer;
begin
  select count(*) into visible_pairs from terra_private.source_response_pairs;
  if visible_pairs <> 2 then
    raise exception 'Reviewer expected two private pairs, saw %', visible_pairs;
  end if;
  begin
    delete from terra_private.source_response_pairs;
    raise exception 'Reviewer unexpectedly deleted private pairs';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'reviewer can inspect but cannot delete pairs');

set local role terra_operator;
do $$
begin
  begin
    perform count(*) from terra_private.source_response_pairs;
    raise exception 'Operator unexpectedly read private pairs';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'operator cannot read source pair contents');

set local role terra_collector;
do $$
begin
  begin
    insert into terra_private.source_response_pairs
      (registration_id, attempt_key, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at)
    values
      ('c1111111-1111-4111-8111-111111111111', 'synthetic-unbound-collector',
       'd1111111-1111-4111-8111-111111111111',
       'd2222222-2222-4222-8222-222222222222', now(), now());
    raise exception 'Unbound collector unexpectedly wrote a pair';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'unbound collector has no pair write path');

select * from finish();
rollback;
