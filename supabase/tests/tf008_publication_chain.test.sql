\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into terra_private.jurisdictions (id, display_name)
values ('TF-CHAIN', 'Synthetic chain jurisdiction');
insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale)
values
  ('11111111-1111-4111-8111-111111111111', 'TF-CHAIN', 'first', 'First synthetic issue', 'Synthetic group', 'Chain test'),
  ('22222222-2222-4222-8222-222222222222', 'TF-CHAIN', 'second', 'Second synthetic issue', 'Synthetic group', 'Chain test');

insert into terra_private.issue_publications
  (id, issue_id, revision, publication_kind, snapshot, dependency_manifest)
values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 1, 'draft', '{}', '{}'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 1, 'accepted', '{}', '{}');

do $$ begin
  begin
    insert into terra_private.issue_heads (issue_id, current_publication_id, changed_at)
    values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', now());
    raise exception 'Draft head unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'draft cannot become an active head');

insert into terra_private.issue_publications
  (id, issue_id, revision, predecessor_id, publication_kind, snapshot, dependency_manifest)
values ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 2,
        '33333333-3333-4333-8333-333333333333', 'accepted', '{}', '{}');
select is((select revision from terra_private.issue_publications where id = '55555555-5555-4555-8555-555555555555'), 2,
          'second revision may follow its actual predecessor');

do $$ begin
  begin
    insert into terra_private.issue_heads (issue_id, current_publication_id, changed_at)
    values ('11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555', now());
    raise exception 'Initial head unexpectedly skipped revision one';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'initial head cannot skip revision one');

do $$ begin
  begin
    insert into terra_private.issue_publications
      (issue_id, revision, predecessor_id, publication_kind, snapshot, dependency_manifest)
    values ('22222222-2222-4222-8222-222222222222', 3,
            '44444444-4444-4444-8444-444444444444', 'accepted', '{}', '{}');
    raise exception 'Revision chain unexpectedly skipped two';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'new revision cannot skip its predecessor');

insert into terra_private.issue_heads (issue_id, current_publication_id, changed_at)
values ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', now());
select is((select current_publication_id from terra_private.issue_heads where issue_id = '22222222-2222-4222-8222-222222222222'),
          '44444444-4444-4444-8444-444444444444'::uuid, 'accepted first revision can become head');

insert into terra_private.issue_publications
  (id, issue_id, revision, predecessor_id, publication_kind, snapshot, dependency_manifest)
values
  ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 2,
   '44444444-4444-4444-8444-444444444444', 'correction', '{}', '{}'),
  ('77777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', 3,
   '66666666-6666-4666-8666-666666666666', 'suppression', '{}', '{}');

do $$ begin
  begin
    update terra_private.issue_heads
      set current_publication_id = '77777777-7777-4777-8777-777777777777', changed_at = now()
      where issue_id = '22222222-2222-4222-8222-222222222222';
    raise exception 'Head unexpectedly skipped correction revision';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'head cannot jump over a correction');

update terra_private.issue_heads
  set current_publication_id = '66666666-6666-4666-8666-666666666666', changed_at = now()
  where issue_id = '22222222-2222-4222-8222-222222222222';
select is((select current_publication_id from terra_private.issue_heads where issue_id = '22222222-2222-4222-8222-222222222222'),
          '66666666-6666-4666-8666-666666666666'::uuid, 'linked correction advances the head');

do $$ begin
  begin
    update terra_private.issue_heads set changed_at = now()
      where issue_id = '22222222-2222-4222-8222-222222222222';
    raise exception 'Same head unexpectedly reactivated';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'same revision cannot be activated twice');

do $$ begin
  begin
    update terra_private.issue_heads
      set current_publication_id = null, changed_at = null
      where issue_id = '22222222-2222-4222-8222-222222222222';
    raise exception 'Head unexpectedly cleared';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'active head cannot be silently cleared');

update terra_private.issue_heads
  set current_publication_id = '77777777-7777-4777-8777-777777777777', changed_at = now()
  where issue_id = '22222222-2222-4222-8222-222222222222';
select is((select current_publication_id from terra_private.issue_heads where issue_id = '22222222-2222-4222-8222-222222222222'),
          '77777777-7777-4777-8777-777777777777'::uuid, 'linked suppression revision advances the head');

select * from finish();
rollback;
