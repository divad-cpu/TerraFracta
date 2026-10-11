\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(not has_function_privilege('terra_issue_reader',
  'terra_private.read_issue_candidate_unfiltered(text,text)', 'EXECUTE'),
  'reader cannot call the unfiltered owner function');
select ok(not has_function_privilege('terra_issue_reader',
  'terra_private.has_exact_json_keys(jsonb,text[])', 'EXECUTE'),
  'reader cannot call the internal key helper');
select ok(not has_function_privilege('terra_issue_reader',
  'terra_private.is_closed_public_issue_payload(jsonb,jsonb)', 'EXECUTE'),
  'reader cannot call the internal shape helper');
select ok(has_function_privilege('terra_issue_reader',
  'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
  'reader retains only the closed candidate entry point');
select ok(not has_function_privilege('anon',
  'terra_private.read_issue_candidate_unfiltered(text,text)', 'EXECUTE'),
  'anonymous role cannot call the old function');
select ok(not has_function_privilege('authenticated',
  'terra_private.read_issue_candidate(text,text)', 'EXECUTE'),
  'ordinary authenticated role cannot call the wrapper');
select ok((select p.prosecdef and p.provolatile='s'
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='terra_private' and p.proname='read_issue_candidate'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='text, text'),
  'closed candidate wrapper stays stable and security definer');
select ok((select 'search_path=pg_catalog, pg_temp'=any(p.proconfig)
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='terra_private' and p.proname='read_issue_candidate'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='text, text'),
  'closed candidate wrapper pins trusted lookup path');
select ok(not terra_private.is_closed_public_issue_payload(
    '{"rawArchivePath":"/private/canary"}'::jsonb,
    '{"sourceVersionIds":[]}'::jsonb),
  'extra private snapshot key cannot satisfy the closed shape');

select * from finish();
rollback;
