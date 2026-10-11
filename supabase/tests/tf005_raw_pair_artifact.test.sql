\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- All source and pair rows, temporary grants, and assertions roll back.
grant terra_reviewer, terra_operator, terra_collector to postgres;
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint)
values
  ('a1111111-1111-4111-8111-111111111111',
   'synthetic-raw-artifact', 'Synthetic', 'https://example.test/raw');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values
  ('a2111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   'metadata', 'https://example.test/raw/metadata',
   '2026-09-25 10:00:00+00', repeat('a', 64)),
  ('a3111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   'data', 'https://example.test/raw/data',
   '2026-09-25 10:00:01+00', repeat('b', 64));
insert into terra_private.source_response_pairs
  (id, registration_id, attempt_key, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at)
values
  ('a4111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111', 'synthetic-raw-attempt-1',
   'a2111111-1111-4111-8111-111111111111',
   'a3111111-1111-4111-8111-111111111111',
   '2026-09-25 10:00:00+00', '2026-09-25 10:00:01+00'),
  ('a4222222-2222-4222-8222-222222222222',
   'a1111111-1111-4111-8111-111111111111', 'synthetic-raw-attempt-2',
   'a2111111-1111-4111-8111-111111111111',
   'a3111111-1111-4111-8111-111111111111',
   '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00');

insert into terra_private.source_raw_pair_artifacts
  (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
   metadata_sha256, data_sha256, stored_at, expires_at)
values
  ('a4111111-1111-4111-8111-111111111111',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
   '2026-09-25 10:00:00+00', '2026-09-25 10:00:01+00',
   repeat('c', 32), repeat('a', 64), repeat('b', 64),
   '2026-09-25 10:00:02+00', '2026-10-25 10:00:00+00');
select is((select count(*)::integer from terra_private.source_raw_pair_artifacts),
          1, 'one raw artifact binds a pair and exact elapsed-time expiry');

do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00',
       repeat('d', 32), repeat('a', 64), repeat('b', 64),
       '2026-09-25 10:01:02+00', '2026-10-25 10:01:01+00');
    raise exception 'Accepted expiry one second late';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'expiry beyond exact 720 hours is rejected');

set local timezone = 'Europe/Oslo';
do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00',
       repeat('d', 32), repeat('a', 64), repeat('b', 64),
       '2026-09-25 10:01:02+00',
       '2026-09-25 10:01:00+00'::timestamptz + interval '30 days');
    raise exception 'Accepted a timezone-adjusted 30 calendar day expiry';
  exception when check_violation then null;
  end;
end;
$$;
reset timezone;
select ok(true, 'calendar-day expiry across Oslo daylight saving is rejected');

do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:01+00', '2026-09-25 10:01:01+00',
       repeat('d', 32), repeat('a', 64), repeat('b', 64),
       '2026-09-25 10:01:02+00', '2026-10-25 10:01:01+00');
    raise exception 'Accepted a timestamp not bound to the pair';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'artifact retrieval times must match the bound pair');

do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00',
       repeat('d', 32), repeat('a', 64), repeat('b', 64),
       '2026-09-25 10:00:59+00', '2026-10-25 10:01:00+00');
    raise exception 'Accepted storage before data retrieval';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'raw artifact cannot predate the recorded data retrieval');

do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00',
       'not-an-attempt-id', repeat('a', 64), repeat('b', 64),
       '2026-09-25 10:01:02+00', '2026-10-25 10:01:00+00');
    raise exception 'Accepted invalid raw attempt identity';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'raw attempt identity must match the private folder format');

do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00',
       repeat('d', 32), 'bad-hash', repeat('b', 64),
       '2026-09-25 10:01:02+00', '2026-10-25 10:01:00+00');
    raise exception 'Accepted invalid hash';
  exception when check_violation then null;
  end;
end;
$$;
select ok(true, 'raw artifact hashes have an exact lowercase SHA-256 shape');

do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00',
       repeat('c', 32), repeat('a', 64), repeat('b', 64),
       '2026-09-25 10:01:02+00', '2026-10-25 10:01:00+00');
    raise exception 'Accepted duplicate raw attempt identity';
  exception when unique_violation then null;
  end;
end;
$$;
select ok(true, 'one raw folder cannot represent two pair IDs');

select ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role'),
                        ('terra_collector'), ('terra_operator')) excluded(role_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) operation(privilege_name)
    where has_table_privilege(excluded.role_name,
                              'terra_private.source_raw_pair_artifacts',
                              operation.privilege_name)
  ), 'excluded roles have no direct raw-artifact table privilege'
);

grant usage on schema terra_private to anon;
grant select on terra_private.source_raw_pair_artifacts to anon;
set local role anon;
do $$
declare visible integer;
begin
  select count(*) into visible from terra_private.source_raw_pair_artifacts;
  if visible <> 0 then
    raise exception 'Anonymous role saw % raw artifact records through RLS', visible;
  end if;
end;
$$;
reset role;
select ok(true, 'RLS hides raw artifacts after an accidental anonymous SELECT grant');

set local role terra_reviewer;
do $$
declare visible integer;
begin
  select count(*) into visible from terra_private.source_raw_pair_artifacts;
  if visible <> 1 then
    raise exception 'Reviewer expected one raw artifact, saw %', visible;
  end if;
  begin
    delete from terra_private.source_raw_pair_artifacts;
    raise exception 'Reviewer unexpectedly deleted raw artifacts';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'reviewer may read but cannot delete raw artifact records');

set local role terra_operator;
do $$
begin
  begin
    perform count(*) from terra_private.source_raw_pair_artifacts;
    raise exception 'Operator unexpectedly read raw artifacts';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'operator cannot read raw artifact records');

set local role terra_collector;
do $$
begin
  begin
    insert into terra_private.source_raw_pair_artifacts
      (pair_id, metadata_version_id, data_version_id,
       metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
       metadata_sha256, data_sha256, stored_at, expires_at)
    values
      ('a4222222-2222-4222-8222-222222222222',
       'a2111111-1111-4111-8111-111111111111',
       'a3111111-1111-4111-8111-111111111111',
       '2026-09-25 10:01:00+00', '2026-09-25 10:01:01+00',
       repeat('d', 32), repeat('a', 64), repeat('b', 64),
       '2026-09-25 10:01:02+00', '2026-10-25 10:01:00+00');
    raise exception 'Unbound collector unexpectedly wrote raw artifact';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'unbound collector has no raw-artifact write path');

select * from finish();
rollback;
