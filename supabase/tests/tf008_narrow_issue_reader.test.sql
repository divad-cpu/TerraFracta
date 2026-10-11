\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select ok((select not rolcanlogin and not rolbypassrls and not rolcreaterole
           from pg_catalog.pg_roles where rolname='terra_issue_reader'),
          'issue reader cannot log in, bypass RLS or create roles');
select ok(not exists (
  select 1 from pg_catalog.pg_auth_members m
  join pg_catalog.pg_roles r on r.oid=m.roleid
  join pg_catalog.pg_roles member on member.oid=m.member
  where member.rolname='terra_issue_reader'
     or (r.rolname='terra_issue_reader'
       and (member.rolname <> 'postgres' or m.inherit_option or m.set_option))),
  'only the migration owner has administrative membership, without inherit or SET');
select ok(has_schema_privilege('terra_issue_reader', 'terra_private', 'USAGE'),
          'reader can resolve the private function schema');
select ok(has_function_privilege('terra_issue_reader',
          'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
          'reader may execute only the candidate function');
select is((select count(*)::int from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='terra_private' and p.proname <> 'read_issue_candidate'
    and has_function_privilege('terra_issue_reader', p.oid, 'EXECUTE')),
  0, 'reader cannot execute any other private function');
select ok(not has_function_privilege('anon',
          'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
          'anonymous client cannot execute the candidate function');
select ok(not has_function_privilege('authenticated',
          'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
          'ordinary authenticated client cannot execute the candidate function');
select ok(not has_function_privilege('service_role',
          'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
          'Supabase service role has no candidate-function grant');
select is((select count(*)::int from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='terra_private' and c.relkind='r'
    and (has_table_privilege('terra_issue_reader', c.oid, 'SELECT')
      or has_any_column_privilege('terra_issue_reader', c.oid, 'SELECT'))),
  0, 'reader has no direct table or column SELECT anywhere in the private schema');
select is((select count(*)::int from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='terra_private' and c.relkind='r'
    and (has_table_privilege('terra_issue_reader', c.oid, 'INSERT')
      or has_table_privilege('terra_issue_reader', c.oid, 'UPDATE')
      or has_table_privilege('terra_issue_reader', c.oid, 'DELETE'))),
  0, 'reader has no direct table write grant');
select ok((select p.prosecdef and p.provolatile='s'
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='terra_private' and p.proname='read_issue_candidate'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='text, text'),
  'candidate function is stable and security definer');
select ok((select 'search_path=pg_catalog, pg_temp'=any(p.proconfig)
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='terra_private' and p.proname='read_issue_candidate'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='text, text'),
  'candidate function pins trusted lookup path');
select ok(terra_private.read_issue_candidate('absent-country', 'absent-issue') is null,
          'absent route returns no private candidate');
select ok(terra_private.read_issue_candidate(null, 'absent-issue') is null,
          'null route argument returns no candidate');

-- This grant only allows the local migration owner to impersonate a NOLOGIN
-- role while the test transaction is open; rollback removes it.
grant terra_issue_reader to postgres;
set local role terra_issue_reader;
do $$
begin
  if terra_private.read_issue_candidate('absent-country', 'absent-issue') is not null then
    raise exception 'reader received a candidate for an absent route';
  end if;
end;
$$;
reset role;
select ok(true, 'reader can execute the candidate function under its own permissions');
set local role terra_issue_reader;
do $$
begin
  begin
    perform count(*) from terra_private.issue_publications;
    raise exception 'reader unexpectedly selected private publication rows';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'reader cannot select the underlying publication table');

set local role anon;
do $$
begin
  begin
    perform terra_private.read_issue_candidate('absent-country', 'absent-issue');
    raise exception 'anonymous client unexpectedly executed private candidate function';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select ok(true, 'anonymous client cannot invoke the function');

select * from finish();
rollback;
