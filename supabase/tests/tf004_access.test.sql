\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- The local migration owner may impersonate test-only NOLOGIN roles inside this transaction.
grant terra_collector, terra_reviewer, terra_operator to postgres;

-- Synthetic records exist only inside this transaction; the final rollback removes them.
insert into terra_private.jurisdictions (id, display_name)
values ('TF-TEST', 'Synthetic test jurisdiction');

insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint)
values
  ('11111111-1111-4111-8111-111111111111', 'synthetic-source', 'Synthetic publisher', 'https://example.test/data');

insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values
  ('22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111',
   'synthetic-item', 'https://example.test/data/item', now(), repeat('a', 64));

insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale)
values
  ('33333333-3333-4333-8333-333333333333', 'TF-TEST', 'synthetic-issue',
   'Synthetic issue', 'Synthetic population', 'Access test only');

insert into terra_private.claims
  (id, issue_id, claim_type, assertion)
values
  ('44444444-4444-4444-8444-444444444444',
   '33333333-3333-4333-8333-333333333333',
   'condition', 'Synthetic claim, not a real-world assertion');

insert into terra_private.claim_evidence
  (claim_id, source_version_id, locator, relation, origin_group)
values
  ('44444444-4444-4444-8444-444444444444',
   '22222222-2222-4222-8222-222222222222',
   'synthetic table cell A1', 'supports', 'synthetic-origin');

insert into terra_private.issue_publications
  (id, issue_id, revision, snapshot, dependency_manifest)
values
  ('55555555-5555-4555-8555-555555555555',
   '33333333-3333-4333-8333-333333333333',
   1, '{"title":"synthetic draft"}', '{}');

insert into terra_private.issue_heads (issue_id)
values ('33333333-3333-4333-8333-333333333333');

insert into terra_private.update_runs
  (jurisdiction_id, request_key, request_fingerprint, requested_by, mode)
values ('TF-TEST', 'synthetic-request', repeat('0', 64), 'synthetic-operator', 'shadow');

do $$
declare unprotected_tables integer;
begin
  select count(*) into unprotected_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'terra_private' and c.relkind = 'r' and not c.relrowsecurity;
  if unprotected_tables <> 0 then
    raise exception 'Expected every private table to have RLS; found % unprotected', unprotected_tables;
  end if;

  begin
    insert into terra_private.source_registrations
      (source_key, publisher, exact_endpoint, fetch_enabled)
    values ('invalid-enabled-source', 'Synthetic', 'https://example.test/bad', true);
    raise exception 'Candidate source unexpectedly enabled fetching';
  exception when check_violation then null;
  end;

  begin
    insert into terra_private.issue_publications
      (issue_id, revision, snapshot, dependency_manifest)
    values ('33333333-3333-4333-8333-333333333333', 2, '{}', '{}');
    raise exception 'Revision 2 unexpectedly accepted without a predecessor';
  exception when check_violation then null;
  end;

  begin
    insert into terra_private.claim_evidence
      (claim_id, source_version_id, locator, relation, origin_group)
    values ('44444444-4444-4444-8444-444444444444',
            '22222222-2222-4222-8222-222222222222', ' ', 'context', 'synthetic-origin');
    raise exception 'Blank evidence locator unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    insert into terra_private.update_runs
      (jurisdiction_id, request_key, request_fingerprint, requested_by, mode)
    values ('TF-TEST', 'synthetic-request', repeat('1', 64), 'another-operator', 'shadow');
    raise exception 'Duplicate request key unexpectedly accepted';
  exception when unique_violation then null;
  end;

  insert into terra_private.issue_dossiers
    (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale)
  values ('66666666-6666-4666-8666-666666666666', 'TF-TEST', 'other-issue',
          'Other synthetic issue', 'Synthetic population', 'Cross-issue test only');
  begin
    insert into terra_private.issue_heads (issue_id, current_publication_id, changed_at)
    values ('66666666-6666-4666-8666-666666666666',
            '55555555-5555-4555-8555-555555555555', now());
    raise exception 'Publication head unexpectedly crossed issue identity';
  exception when check_violation then null; -- the chain guard rejects the cross-issue target before the FK
  end;
end;
$$;
select ok(true, 'private tables and core constraints hold');

set local role anon;
do $$
begin
  begin
    perform count(*) from terra_private.issue_dossiers;
    raise exception 'anon unexpectedly read a private dossier';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from terra_private.issue_publications;
    raise exception 'anon unexpectedly read a draft publication';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'anon cannot read private dossier or draft through SQL grants');

set local role authenticated;
do $$
begin
  begin
    perform count(*) from terra_private.source_versions;
    raise exception 'authenticated unexpectedly read a source version';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'ordinary authenticated role cannot read source versions');

set local role service_role;
do $$
begin
  begin
    perform count(*) from terra_private.claim_evidence;
    raise exception 'service_role unexpectedly read private evidence';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'service_role has no private schema usage despite RLS bypass capability');

-- Temporarily grant the SQL privilege to exercise RLS as a second defense.
-- These grants disappear with the rollback and are never part of the migration.
reset role;
grant usage on schema terra_private to anon, authenticated;
grant select on terra_private.issue_publications to anon, authenticated;

set local role anon;
do $$
declare visible_drafts integer;
begin
  select count(*) into visible_drafts from terra_private.issue_publications;
  if visible_drafts <> 0 then
    raise exception 'anon saw % private draft publications through RLS', visible_drafts;
  end if;
end;
$$;
reset role;
select ok(true, 'RLS hides draft even if anon receives temporary SQL SELECT');

set local role authenticated;
do $$
declare visible_drafts integer;
begin
  select count(*) into visible_drafts from terra_private.issue_publications;
  if visible_drafts <> 0 then
    raise exception 'authenticated saw % private draft publications through RLS', visible_drafts;
  end if;
end;
$$;
reset role;
select ok(true, 'RLS hides draft even if authenticated receives temporary SQL SELECT');

set local role terra_collector;
do $$
begin
  begin
    perform count(*) from terra_private.source_registrations;
    raise exception 'collector unexpectedly read candidate registration';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into terra_private.source_versions
      (registration_id, item_key, source_url, retrieved_at, content_sha256)
    values ('11111111-1111-4111-8111-111111111111',
            'unauthorized', 'https://example.test/unauthorized', now(), repeat('b', 64));
    raise exception 'collector unexpectedly wrote a source version';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'collector cannot read candidates or write source versions');

set local role terra_reviewer;
do $$
declare visible_claims integer;
begin
  select count(*) into visible_claims from terra_private.claims;
  if visible_claims <> 1 then
    raise exception 'reviewer expected one synthetic claim, saw %', visible_claims;
  end if;
  begin
    update terra_private.claims set assertion = 'Unauthorized rewrite';
    raise exception 'reviewer unexpectedly modified a claim';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'reviewer reads private claim but cannot rewrite it');

set local role terra_operator;
do $$
declare visible_runs integer;
begin
  select count(*) into visible_runs from terra_private.update_runs;
  if visible_runs <> 1 then
    raise exception 'operator expected one synthetic run, saw %', visible_runs;
  end if;
  begin
    perform count(*) from terra_private.issue_dossiers;
    raise exception 'operator unexpectedly read a private dossier';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'operator reads run records but not dossiers');

select * from finish();
rollback;
