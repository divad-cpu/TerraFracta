-- Owner-only structural and terminal-state checks. Always roll back.
begin;
create extension if not exists pgtap with schema extensions;
-- TF_RUN_COMPLETION_OVERLAY
select no_plan();
select has_table('terra_private','update_run_manifests','Private captured manifests exist');
select has_table('terra_private','update_run_closeouts','Private processing receipts exist');
select has_table('terra_private','update_run_source_checks','Fresh source checks exist independently from versions');
select is((select count(*)::integer from information_schema.columns where table_schema='terra_private'
 and table_name in('update_run_manifests','update_run_closeouts','update_run_source_checks')),19,'Exactly nineteen new private fields');
select ok(relrowsecurity,'RLS enabled on '||relname) from pg_class
 where oid in('terra_private.update_run_manifests'::regclass,'terra_private.update_run_closeouts'::regclass,'terra_private.update_run_source_checks'::regclass)
 order by relname;
select ok(not p.prosecdef and p.proconfig=array['search_path=pg_catalog, pg_temp'],
 'Invoker function with fixed search path: '||p.proname) from pg_proc p
 where p.pronamespace='terra_private'::regnamespace and p.proname in(
 'validate_run_manifest','check_run_source_check_insert','check_run_manifest_insert','check_planned_machine_decision',
 'summarize_run_processing','check_run_closeout','check_closed_run_change','close_update_run_processing')
 order by p.proname;
select ok(not has_function_privilege(r.role_name,p.oid,'EXECUTE'),r.role_name||' cannot execute '||p.proname)
 from (values('anon'),('authenticated'),('service_role'),('terra_collector'),
 ('terra_operator'),('terra_reviewer'),('terra_issue_reader')) r(role_name) cross join pg_proc p
 where p.pronamespace='terra_private'::regnamespace and p.proname in(
 'validate_run_manifest','check_run_source_check_insert','check_run_manifest_insert','check_planned_machine_decision',
 'summarize_run_processing','check_run_closeout','check_closed_run_change','close_update_run_processing')
 order by r.role_name,p.proname;
select ok(not has_table_privilege(r.role_name,t.table_name,'INSERT') and
 not has_table_privilege(r.role_name,t.table_name,'UPDATE') and not has_table_privilege(r.role_name,t.table_name,'DELETE'),
 r.role_name||' has no DML on '||t.table_name)
 from (values('anon'),('authenticated'),('service_role'),('terra_collector'),
 ('terra_operator'),('terra_reviewer'),('terra_issue_reader')) r(role_name)
 cross join (values('terra_private.update_run_manifests'),('terra_private.update_run_closeouts'),('terra_private.update_run_source_checks')) t(table_name)
 order by r.role_name,t.table_name;
select ok(has_table_privilege(r.role_name,t.table_name,'SELECT'),r.role_name||' can inspect private '||t.table_name)
 from (values('terra_operator'),('terra_reviewer')) r(role_name)
 cross join (values('terra_private.update_run_manifests'),('terra_private.update_run_closeouts'),('terra_private.update_run_source_checks')) t(table_name)
 order by r.role_name,t.table_name;
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
 where p.pronamespace='terra_private'::regnamespace and p.proname in(
 'validate_run_manifest','check_run_source_check_insert','check_run_manifest_insert','check_planned_machine_decision',
 'summarize_run_processing','check_run_closeout','check_closed_run_change','close_update_run_processing')
 and a.grantee=0 and a.privilege_type='EXECUTE'),'No PUBLIC execute grant');

-- TF_RUN_COMPLETION_STAGE
create temporary table checked_closeout(response jsonb);
-- TF_RUN_COMPLETION_CLOSE
select is((select response->>'status' from checked_closeout),'closed','Resolved held case closes');
select is((select response #>> '{summary,runState}' from checked_closeout),'completed','Processing can finish with a resolved hold');
select is((select response #>> '{summary,visibilityState}' from checked_closeout),'not_required','No activation means no visibility claim');
select is((select response #>> '{summary,commitState}' from checked_closeout),'none','Staging is not a committed publication');
select is((select response #>> '{summary,heldItems}' from checked_closeout),'1','Hold counted exactly once');
select is((select response #> '{summary,pendingItemKeys}' from checked_closeout),'[]'::jsonb,'No missing item hidden');
select is((select finished_at from terra_private.update_runs),(select finished_at from terra_private.update_run_closeouts),'Same exact finished time');
select throws_ok('update terra_private.update_run_manifests set canonical_manifest=canonical_manifest',
 '23514','Automatic decision records are append-only','Captured plan cannot change');
select throws_ok('delete from terra_private.update_run_manifests',
 '23514','Automatic decision records are append-only','Captured plan cannot disappear');
select throws_ok('update terra_private.update_run_closeouts set summary=summary',
 '23514','Automatic decision records are append-only','Processing receipt cannot change');
select throws_ok('delete from terra_private.update_run_closeouts',
 '23514','Automatic decision records are append-only','Processing receipt cannot disappear');
select throws_ok('update terra_private.update_run_source_checks set checked_at=checked_at',
 '23514','Automatic decision records are append-only','Source check cannot change');
select throws_ok('delete from terra_private.update_run_source_checks',
 '23514','Automatic decision records are append-only','Fresh source check cannot disappear');
select throws_ok('update terra_private.update_runs set run_state=''running'',finished_at=null',
 '23514','Closed processing run is immutable','Finished work cannot be reopened');
select throws_ok('delete from terra_private.update_runs',
 '23514','Closed processing run is immutable','Finished run cannot disappear');
set constraints terra_private.run_closeout_commit_guard immediate;
select pass('Deferred closeout guard agrees with finished run and current lease');
select * from finish();
rollback;
