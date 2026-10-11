\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
grant terra_reviewer, terra_collector, terra_operator to postgres;

insert into terra_private.jurisdictions (id, display_name)
values ('TF-CITATION', 'Synthetic citation jurisdiction');
insert into terra_private.source_registrations (id, source_key, publisher, exact_endpoint)
values ('11111111-1111-4111-8111-111111111111', 'citation-source', 'Synthetic publisher', 'https://example.test/source');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
        'synthetic-item', 'https://example.test/item', now(), repeat('a',64));
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale)
values
  ('33333333-3333-4333-8333-333333333333', 'TF-CITATION', 'issue-one', 'First synthetic issue', 'Synthetic', 'Test'),
  ('44444444-4444-4444-8444-444444444444', 'TF-CITATION', 'issue-two', 'Second synthetic issue', 'Synthetic', 'Test');
insert into terra_private.claims (id, issue_id, claim_type, assertion)
values
  ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', 'condition', 'Synthetic claim one'),
  ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444', 'condition', 'Synthetic claim two');
insert into terra_private.claim_evidence (claim_id, source_version_id, locator, relation, origin_group)
values
  ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'table A1', 'supports', 'synthetic-origin'),
  ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'note B2', 'context', 'synthetic-origin'),
  ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 'table C3', 'supports', 'synthetic-origin');
insert into terra_private.issue_publications
  (id, issue_id, revision, publication_kind, snapshot, dependency_manifest)
values ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333', 1, 'draft', '{}', '{}');

insert into terra_private.issue_publication_citations
  (publication_id, issue_id, claim_id, source_version_id, locator, relation)
values ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333',
        '55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222',
        'table A1', 'supports');
select is((select count(*)::int from terra_private.issue_publication_citations), 1,
          'exact supporting citation can attach to its issue revision');

insert into terra_private.issue_publication_citations
  (publication_id, issue_id, claim_id, source_version_id, locator, relation)
values ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333',
        '55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222',
        'note B2', 'context');
select is((select count(*)::int from terra_private.issue_publication_citations), 2,
          'context can be retained beside the supporting citation');

do $$ begin
  begin
    insert into terra_private.issue_publication_citations
      (publication_id, issue_id, claim_id, source_version_id, locator, relation)
    values ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333',
            '66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222',
            'table C3', 'supports');
    raise exception 'Cross-issue claim unexpectedly attached';
  exception when foreign_key_violation then null;
  end;
end $$;
select ok(true, 'claim from another issue is rejected');

do $$ begin
  begin
    insert into terra_private.issue_publication_citations
      (publication_id, issue_id, claim_id, source_version_id, locator, relation)
    values ('77777777-7777-4777-8777-777777777777', '44444444-4444-4444-8444-444444444444',
            '66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222',
            'table C3', 'supports');
    raise exception 'Cross-issue publication unexpectedly attached';
  exception when foreign_key_violation then null;
  end;
end $$;
select ok(true, 'publication from another issue is rejected');

do $$ begin
  begin
    insert into terra_private.issue_publication_citations
      (publication_id, issue_id, claim_id, source_version_id, locator, relation)
    values ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333',
            '55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222',
            'table Z9', 'supports');
    raise exception 'Wrong locator unexpectedly attached';
  exception when foreign_key_violation then null;
  end;
end $$;
select ok(true, 'locator must identify existing claim evidence');

do $$ begin
  begin
    insert into terra_private.issue_publication_citations
      (publication_id, issue_id, claim_id, source_version_id, locator, relation)
    values ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333',
            '55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222',
            'table A1', 'supports');
    raise exception 'Duplicate citation unexpectedly attached';
  exception when unique_violation then null;
  end;
end $$;
select ok(true, 'duplicate citation is rejected');

select ok((select relrowsecurity from pg_class where oid = 'terra_private.issue_publication_citations'::regclass),
          'new citation table has RLS');
select ok(has_table_privilege('terra_reviewer', 'terra_private.issue_publication_citations', 'SELECT'),
          'private reviewer can read citation metadata');
select ok(not has_table_privilege('anon', 'terra_private.issue_publication_citations', 'SELECT'),
          'anonymous role has no citation table grant');
select ok(not has_table_privilege('service_role', 'terra_private.issue_publication_citations', 'SELECT'),
          'service role has no citation table grant');
select ok(not has_table_privilege('terra_collector', 'terra_private.issue_publication_citations', 'INSERT'),
          'collector cannot attach publication citations');

select * from finish();
rollback;
