\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into terra_private.jurisdictions (id, display_name)
values ('TF-TEXT-TEST', 'Fictional text review place');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population,
   selection_rationale)
values ('11111111-1111-4111-8111-111111111111', 'TF-TEXT-TEST',
        'fictional-text-review', 'Fictional issue', 'Fictional group',
        'Local structural test');
insert into terra_private.issue_publications
  (id, issue_id, revision, publication_kind, snapshot, dependency_manifest,
   created_at)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111', 1, 'accepted', '{}', '{}',
        '2026-09-25T12:00:00Z');
insert into terra_private.issue_publications
  (id, issue_id, revision, predecessor_id, publication_kind, snapshot,
   dependency_manifest, created_at)
values ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111', 2,
        '22222222-2222-4222-8222-222222222222', 'correction', '{}', '{}',
        '2026-09-25T12:00:00Z');
insert into terra_private.issue_text_reviews
  (publication_id, revision, decision, display_title, display_summary,
   reviewed_at, review_reference)
values ('22222222-2222-4222-8222-222222222222', 1, 'accepted',
        'Fictional issue', 'Fictional summary', '2026-09-25T12:30:00Z',
        'synthetic-review');
select is((select count(*)::int from terra_private.issue_text_reviews), 1,
          'first accepted-looking text event is stored privately');

do $$ begin
  begin
    insert into terra_private.issue_text_reviews
      (publication_id, revision, decision, display_title, display_summary,
       reviewed_at, review_reference)
    values ('22222222-2222-4222-8222-222222222222', 3, 'accepted',
            'Skipped', 'Skipped', '2026-09-25T12:40:00Z', 'synthetic-review');
    raise exception 'Skipped text revision unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'text decisions cannot skip revisions');

do $$ begin
  begin
    insert into terra_private.issue_text_reviews
      (publication_id, revision, decision, reviewed_at, review_reference)
    values ('33333333-3333-4333-8333-333333333333', 1, 'withdrawn',
            '2026-09-25T12:30:00Z', 'synthetic-review');
    raise exception 'Initial withdrawal unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'first text event cannot be a withdrawal');

do $$ begin
  begin
    insert into terra_private.issue_text_reviews
      (publication_id, revision, decision, reviewed_at, review_reference)
    values ('22222222-2222-4222-8222-222222222222', 2, 'withdrawn',
            '2026-09-25T11:59:59Z', 'synthetic-review');
    raise exception 'Review before publication unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'text review cannot predate the publication');

do $$ begin
  begin
    update terra_private.issue_text_reviews set display_title='Mutated'
      where publication_id='22222222-2222-4222-8222-222222222222';
    raise exception 'Existing text event unexpectedly updated';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'text review event cannot be updated');

do $$ begin
  begin
    delete from terra_private.issue_text_reviews
      where publication_id='22222222-2222-4222-8222-222222222222';
    raise exception 'Existing text event unexpectedly deleted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'text review event cannot be deleted');

insert into terra_private.issue_text_reviews
  (publication_id, revision, decision, reviewed_at, review_reference)
values ('22222222-2222-4222-8222-222222222222', 2, 'withdrawn',
        '2026-09-25T12:40:00Z', 'synthetic-withdrawal');
select is((select decision from terra_private.issue_text_reviews
            where publication_id='22222222-2222-4222-8222-222222222222'
            order by revision desc limit 1), 'withdrawn',
          'latest event can withdraw the issue text');

insert into terra_private.issue_text_reviews
  (publication_id, revision, decision, display_title, display_summary,
   reviewed_at, review_reference)
values ('22222222-2222-4222-8222-222222222222', 3, 'accepted',
        'Corrected fictional issue', 'Corrected fictional summary',
        '2026-09-25T12:45:00Z', 'synthetic-correction');
select is((select display_title from terra_private.issue_text_reviews
            where publication_id='22222222-2222-4222-8222-222222222222'
            order by revision desc limit 1), 'Corrected fictional issue',
          'later acceptance appends a new text event');

do $$ begin
  begin
    insert into terra_private.issue_text_reviews
      (publication_id, revision, decision, display_title, reviewed_at,
       review_reference)
    values ('33333333-3333-4333-8333-333333333333', 1, 'accepted',
            'Missing summary', '2026-09-25T12:50:00Z', 'synthetic-review');
    raise exception 'Accepted text without summary unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'accepted text requires bounded title and summary');

select ok((select relrowsecurity from pg_catalog.pg_class
           where oid='terra_private.issue_text_reviews'::regclass),
          'text review table has RLS');
select ok(has_table_privilege('terra_reviewer',
          'terra_private.issue_text_reviews', 'SELECT'),
          'private reviewer may inspect text decisions');
select ok(not has_table_privilege('terra_collector',
          'terra_private.issue_text_reviews', 'INSERT'),
          'collector cannot write text decisions');
select ok(not has_table_privilege('terra_issue_reader',
          'terra_private.issue_text_reviews', 'SELECT'),
          'issue reader cannot select private text history');
select ok(not has_function_privilege('terra_issue_reader',
          'terra_private.check_issue_text_review_insert()', 'EXECUTE'),
          'issue reader cannot invoke private text insert guard');

select * from finish();
rollback;
