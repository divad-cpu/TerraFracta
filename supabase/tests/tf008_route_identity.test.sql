\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into terra_private.jurisdictions (id, display_name, public_slug)
values ('TF-LOCK-A', 'First fictional country', null),
       ('TF-LOCK-B', 'Second fictional country', 'second-country');
update terra_private.jurisdictions set public_slug='first-country' where id='TF-LOCK-A';
select is((select public_slug from terra_private.jurisdictions where id='TF-LOCK-A'),
          'first-country', 'unassigned country slug can be set once');

do $$ begin
  begin
    update terra_private.jurisdictions set public_slug='changed-country' where id='TF-LOCK-A';
    raise exception 'Assigned country slug unexpectedly changed';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'assigned country slug cannot change');

do $$ begin
  begin
    update terra_private.jurisdictions set public_slug=null where id='TF-LOCK-A';
    raise exception 'Assigned country slug unexpectedly cleared';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'assigned country slug cannot be cleared');

insert into terra_private.issue_dossiers
  (id, jurisdiction_id, issue_key, title, affected_population, selection_rationale, public_slug)
values
  ('11111111-2222-4333-8444-555555555551', 'TF-LOCK-A', 'first', 'First fictional issue', 'Fictional', 'Test', null),
  ('11111111-2222-4333-8444-555555555552', 'TF-LOCK-A', 'second', 'Second fictional issue', 'Fictional', 'Test', null);
update terra_private.issue_dossiers set public_slug='housing-costs'
  where id='11111111-2222-4333-8444-555555555551';
select is((select public_slug from terra_private.issue_dossiers where id='11111111-2222-4333-8444-555555555551'),
          'housing-costs', 'unassigned issue slug can be set once');

do $$ begin
  begin
    update terra_private.issue_dossiers set public_slug='changed-issue'
      where id='11111111-2222-4333-8444-555555555551';
    raise exception 'Assigned issue slug unexpectedly changed';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'assigned issue slug cannot change');

do $$ begin
  begin
    update terra_private.issue_dossiers set public_slug=null
      where id='11111111-2222-4333-8444-555555555551';
    raise exception 'Assigned issue slug unexpectedly cleared';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'assigned issue slug cannot be cleared');

do $$ begin
  begin
    update terra_private.issue_dossiers set jurisdiction_id='TF-LOCK-B'
      where id='11111111-2222-4333-8444-555555555551';
    raise exception 'Assigned issue unexpectedly moved to another country';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'assigned issue cannot move to a different country');

update terra_private.issue_dossiers set jurisdiction_id='TF-LOCK-B'
  where id='11111111-2222-4333-8444-555555555552';
select is((select jurisdiction_id from terra_private.issue_dossiers where id='11111111-2222-4333-8444-555555555552'),
          'TF-LOCK-B', 'unassigned issue may be moved before it gets a public route');

select is((select count(*)::int from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='terra_private'
    and p.proname in ('keep_jurisdiction_route_identity', 'keep_issue_route_identity')
    and not has_function_privilege('anon', p.oid, 'EXECUTE')),
  2, 'anonymous role cannot invoke route guard functions');

select * from finish();
rollback;
