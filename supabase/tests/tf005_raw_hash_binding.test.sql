\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Every fictional row and attempted update rolls back.
insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint)
values ('b1111111-1111-4111-8111-111111111111',
        'synthetic-hash-binding', 'Synthetic', 'https://example.test/raw');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values
  ('b2111111-1111-4111-8111-111111111111',
   'b1111111-1111-4111-8111-111111111111', 'metadata',
   'https://example.test/raw/metadata', '2026-09-25 10:00:00+00', repeat('a',64)),
  ('b3111111-1111-4111-8111-111111111111',
   'b1111111-1111-4111-8111-111111111111', 'data',
   'https://example.test/raw/data', '2026-09-25 10:00:01+00', repeat('b',64)),
  ('b4111111-1111-4111-8111-111111111111',
   'b1111111-1111-4111-8111-111111111111', 'unselected',
   'https://example.test/raw/other', '2026-09-25 10:00:02+00', repeat('c',64));
insert into terra_private.source_response_pairs
  (id, registration_id, attempt_key, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at)
values ('b5111111-1111-4111-8111-111111111111',
        'b1111111-1111-4111-8111-111111111111', 'synthetic-hash-binding-attempt',
        'b2111111-1111-4111-8111-111111111111',
        'b3111111-1111-4111-8111-111111111111',
        '2026-09-25 10:00:00+00', '2026-09-25 10:00:01+00');
insert into terra_private.source_raw_pair_artifacts
  (pair_id, metadata_version_id, data_version_id,
   metadata_retrieved_at, data_retrieved_at, raw_attempt_id,
   metadata_sha256, data_sha256, stored_at, expires_at)
values ('b5111111-1111-4111-8111-111111111111',
        'b2111111-1111-4111-8111-111111111111',
        'b3111111-1111-4111-8111-111111111111',
        '2026-09-25 10:00:00+00', '2026-09-25 10:00:01+00',
        repeat('d',32), repeat('a',64), repeat('b',64),
        '2026-09-25 10:00:02+00', '2026-10-25 10:00:00+00');
select is((select count(*)::int from terra_private.source_raw_pair_artifacts
           where pair_id='b5111111-1111-4111-8111-111111111111'),
          1, 'artifact can bind the exact pair versions and their hashes');

do $$
begin
  begin
    update terra_private.source_raw_pair_artifacts
      set metadata_version_id='b4111111-1111-4111-8111-111111111111'
      where pair_id='b5111111-1111-4111-8111-111111111111';
    raise exception 'Accepted metadata version outside selected pair';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'artifact cannot point to another version in the registration');

do $$
begin
  begin
    update terra_private.source_raw_pair_artifacts
      set metadata_sha256=repeat('c',64)
      where pair_id='b5111111-1111-4111-8111-111111111111';
    raise exception 'Accepted wrong metadata hash';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'metadata hash must equal the selected source version');

do $$
begin
  begin
    update terra_private.source_raw_pair_artifacts
      set data_sha256=repeat('c',64)
      where pair_id='b5111111-1111-4111-8111-111111111111';
    raise exception 'Accepted wrong data hash';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'data hash must equal the selected source version');

do $$
begin
  begin
    update terra_private.source_versions set content_sha256=repeat('e',64)
      where id='b2111111-1111-4111-8111-111111111111';
    raise exception 'Changed referenced metadata source hash';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'referenced metadata source hash cannot drift');

do $$
begin
  begin
    update terra_private.source_versions set content_sha256=repeat('f',64)
      where id='b3111111-1111-4111-8111-111111111111';
    raise exception 'Changed referenced data source hash';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'referenced data source hash cannot drift');

do $$
begin
  begin
    update terra_private.source_response_pairs
      set metadata_version_id='b4111111-1111-4111-8111-111111111111'
      where id='b5111111-1111-4111-8111-111111111111';
    raise exception 'Changed a pair version after its artifact was bound';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select ok(true, 'selected pair versions cannot drift after artifact binding');

select * from finish();
rollback;
