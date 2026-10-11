\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into terra_private.source_registrations
  (id, source_key, publisher, exact_endpoint)
values ('11111111-1111-4111-8111-111111111111', 'fictional-title-source',
        'Fictional publisher', 'https://example.org/source');
insert into terra_private.source_versions
  (id, registration_id, item_key, source_url, retrieved_at, content_sha256)
values
  ('22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111', 'first',
   'https://example.org/first', '2026-09-25T12:00:00Z', repeat('a', 64)),
  ('33333333-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111', 'second',
   'https://example.org/second', '2026-09-25T12:00:00Z', repeat('b', 64));
insert into terra_private.source_display_reviews
  (source_version_id, revision, decision, display_title, title_language,
   reviewed_at, review_reference)
values ('22222222-2222-4222-8222-222222222222', 1, 'accepted',
        'Fictional table', 'en', '2026-09-25T12:30:00Z', 'synthetic-review');
select is((select count(*)::int from terra_private.source_display_reviews), 1,
          'first accepted-looking title event is stored privately');

do $$ begin
  begin
    insert into terra_private.source_display_reviews
      (source_version_id, revision, decision, display_title, title_language,
       reviewed_at, review_reference)
    values ('22222222-2222-4222-8222-222222222222', 3, 'accepted',
            'Skipped revision', 'en', '2026-09-25T12:40:00Z', 'synthetic-review');
    raise exception 'Skipped title revision unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'source-title decisions cannot skip revisions');

do $$ begin
  begin
    insert into terra_private.source_display_reviews
      (source_version_id, revision, decision, reviewed_at, review_reference)
    values ('33333333-3333-4333-8333-333333333333', 1, 'withdrawn',
            '2026-09-25T12:30:00Z', 'synthetic-review');
    raise exception 'Initial withdrawal unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'first source-title event cannot be a withdrawal');

do $$ begin
  begin
    insert into terra_private.source_display_reviews
      (source_version_id, revision, decision, reviewed_at, review_reference)
    values ('22222222-2222-4222-8222-222222222222', 2, 'withdrawn',
            '2026-09-25T11:59:59Z', 'synthetic-review');
    raise exception 'Review before source retrieval unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'display review cannot predate the source version');

do $$ begin
  begin
    update terra_private.source_display_reviews set display_title='Mutated title'
      where source_version_id='22222222-2222-4222-8222-222222222222';
    raise exception 'Existing title event unexpectedly updated';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'source-title review event cannot be updated');

do $$ begin
  begin
    delete from terra_private.source_display_reviews
      where source_version_id='22222222-2222-4222-8222-222222222222';
    raise exception 'Existing title event unexpectedly deleted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'source-title review event cannot be deleted');

insert into terra_private.source_display_reviews
  (source_version_id, revision, decision, reviewed_at, review_reference)
values ('22222222-2222-4222-8222-222222222222', 2, 'withdrawn',
        '2026-09-25T12:40:00Z', 'synthetic-withdrawal');
select is((select count(*)::int from terra_private.source_display_reviews
            where source_version_id='22222222-2222-4222-8222-222222222222'),
          2, 'withdrawal appends rather than overwrites');
select is((select decision from terra_private.source_display_reviews
            where source_version_id='22222222-2222-4222-8222-222222222222'
            order by revision desc limit 1), 'withdrawn',
          'latest event can withdraw the title');

insert into terra_private.source_display_reviews
  (source_version_id, revision, decision, display_title, title_language,
   reviewed_at, review_reference)
values ('22222222-2222-4222-8222-222222222222', 3, 'accepted',
        'Corrected fictional table', 'en', '2026-09-25T12:45:00Z',
        'synthetic-correction');
select is((select display_title from terra_private.source_display_reviews
            where source_version_id='22222222-2222-4222-8222-222222222222'
            order by revision desc limit 1), 'Corrected fictional table',
          'a later accepted title is a new event');

do $$ begin
  begin
    insert into terra_private.source_display_reviews
      (source_version_id, revision, decision, reviewed_at, review_reference)
    values ('22222222-2222-4222-8222-222222222222', 4, 'accepted',
            '2026-09-25T12:50:00Z', 'synthetic-review');
    raise exception 'Accepted title without wording unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'accepted event requires bounded display wording and language');

select ok((select relrowsecurity from pg_catalog.pg_class
           where oid='terra_private.source_display_reviews'::regclass),
          'source-title review table has RLS');
select ok(has_table_privilege('terra_reviewer',
          'terra_private.source_display_reviews', 'SELECT'),
          'private reviewer may inspect the decision history');
select ok(not has_table_privilege('anon',
          'terra_private.source_display_reviews', 'SELECT'),
          'anonymous role has no review table grant');
select ok(not has_table_privilege('terra_collector',
          'terra_private.source_display_reviews', 'INSERT'),
          'collector cannot write title decisions');
select ok(not has_table_privilege('terra_issue_reader',
          'terra_private.source_display_reviews', 'SELECT'),
          'issue reader cannot select private review history');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.check_source_display_review_insert()', 'EXECUTE'),
          'issue reader cannot invoke the private insert guard');

select * from finish();
rollback;
