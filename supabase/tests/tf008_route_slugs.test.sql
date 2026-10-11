\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into terra_private.jurisdictions (id, display_name, public_slug)
values ('TF-ROUTE-A', 'First synthetic place', null),
       ('TF-ROUTE-B', 'Second synthetic place', 'sample-place');
select is((select count(*)::int from terra_private.jurisdictions where id like 'TF-ROUTE-%'), 2,
          'private research jurisdiction may lack a public slug');

update terra_private.jurisdictions set public_slug = 'other-place' where id = 'TF-ROUTE-A';
select is((select public_slug from terra_private.jurisdictions where id='TF-ROUTE-A'),
          'other-place', 'canonical lowercase country slug can be assigned');

do $$ begin
  begin
    insert into terra_private.jurisdictions (id, display_name, public_slug)
    values ('TF-ROUTE-D', 'Duplicate synthetic place', 'sample-place');
    raise exception 'Duplicate country slug unexpectedly accepted';
  exception when unique_violation then null;
  end;
end $$;
select ok(true, 'country route slug is globally unique');

do $$ begin
  begin
    insert into terra_private.jurisdictions (id, display_name, public_slug)
    values ('TF-ROUTE-E', 'Invalid synthetic place', 'Bad Slug');
    raise exception 'Invalid country slug unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'country slug rejects spaces and uppercase');

do $$ begin
  begin
    insert into terra_private.jurisdictions (id, display_name, coverage_state)
    values ('TF-ROUTE-C', 'Unroutable synthetic place', 'published');
    raise exception 'Published country without route unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'published country cannot lack a public route key');

insert into terra_private.issue_dossiers
  (jurisdiction_id, issue_key, title, affected_population, selection_rationale, public_slug)
values
  ('TF-ROUTE-A', 'first', 'First synthetic issue', 'Synthetic', 'Test', 'housing-costs'),
  ('TF-ROUTE-A', 'second', 'Second synthetic issue', 'Synthetic', 'Test', 'energy-costs'),
  ('TF-ROUTE-B', 'third', 'Third synthetic issue', 'Synthetic', 'Test', 'housing-costs');
select is((select count(*)::int from terra_private.issue_dossiers where issue_key in ('first','second','third')), 3,
          'same issue slug may be reused in a different country');

do $$ begin
  begin
    insert into terra_private.issue_dossiers
      (jurisdiction_id, issue_key, title, affected_population, selection_rationale, public_slug)
    values ('TF-ROUTE-A', 'fourth', 'Duplicate synthetic issue', 'Synthetic', 'Test', 'housing-costs');
    raise exception 'Duplicate issue route unexpectedly accepted';
  exception when unique_violation then null;
  end;
end $$;
select ok(true, 'issue slug is unique within its country');

do $$ begin
  begin
    insert into terra_private.issue_dossiers
      (jurisdiction_id, issue_key, title, affected_population, selection_rationale, public_slug)
    values ('TF-ROUTE-A', 'fifth', 'Invalid synthetic issue', 'Synthetic', 'Test', 'Bad/Slug');
    raise exception 'Invalid issue slug unexpectedly accepted';
  exception when check_violation then null;
  end;
end $$;
select ok(true, 'issue route key rejects uppercase and path punctuation');

update terra_private.jurisdictions set coverage_state='published' where id='TF-ROUTE-A';
select is((select coverage_state from terra_private.jurisdictions where id='TF-ROUTE-A'),
          'published', 'published country is permitted after it has a slug');

select * from finish();
rollback;
