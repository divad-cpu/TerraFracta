\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TF_RUN_ADMISSION_OVERLAY
select is((select provolatile::text from pg_proc
 where oid='terra_private.validate_update_request(text,text)'::regprocedure),'s',
 'Request validation declares its time and JSON dependencies honestly');
create temporary table fixture_requests(name text,request_key text,canonical text,accepted boolean);
-- TF_RUN_ADMISSION_CASES

select ok(c.relrowsecurity,'Admission records have RLS') from pg_class c
 where c.oid='terra_private.update_run_requests'::regclass;
select ok(not p.prosecdef,'Admission preserves invoker privileges') from pg_proc p
 where p.oid='terra_private.admit_update_run(text,text)'::regprocedure;
select ok(not has_function_privilege(role_name,
 'terra_private.admit_update_run(text,text)','EXECUTE'),role_name||' has no admission authority')
 from unnest(array['anon','authenticated','service_role','terra_collector','terra_operator',
                   'terra_reviewer','terra_issue_reader']) roles(role_name);
select ok(not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a
 where p.oid='terra_private.admit_update_run(text,text)'::regprocedure
 and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC execute is revoked');
select ok(not has_table_privilege(role_name,'terra_private.update_run_requests','INSERT'),
 role_name||' cannot insert admission records')
 from unnest(array['anon','authenticated','service_role','terra_collector','terra_operator',
                   'terra_reviewer','terra_issue_reader']) roles(role_name);

select case when accepted then
 lives_ok(format('select terra_private.validate_update_request(%L,%L)',request_key,canonical),name)
 else throws_ok(format('select terra_private.validate_update_request(%L,%L)',request_key,canonical),
 '23514','Update request is invalid',name) end
 from fixture_requests order by name collate "C";

insert into terra_private.jurisdictions(id,display_name)
 values('fictional-country','Fictional admission place');
create temporary table admission_results(first_result jsonb,second_result jsonb);
insert into admission_results(first_result)
 select terra_private.admit_update_run(request_key,canonical)
 from fixture_requests where name='manual';
update admission_results set second_result=(select
 terra_private.admit_update_run(request_key,canonical) from fixture_requests where name='manual');
select is(first_result->>'status','admitted','First request creates a queued run') from admission_results;
select is(second_result->>'status','existing','Same request returns its original run') from admission_results;
select is(first_result->>'runId',second_result->>'runId','Retry preserves exact run ID') from admission_results;
select is(first_result->>'runState','queued','Admission does not start collection') from admission_results;
select is(first_result->>'commitState','none','Admission commits no publication') from admission_results;
select is(first_result->>'visibilityState','not_required','No fictional visibility claim') from admission_results;
select 'TF_ADMISSION_RECEIPT:'||first_result::text from admission_results;
select is((select count(*) from terra_private.update_run_requests),1::bigint,'Only one admission is stored');
select is((select count(*) from terra_private.update_runs where request_key='fictional:admission:v1'),
 1::bigint,'Only one run is stored');
select throws_ok(format('select terra_private.admit_update_run(%L,%L)',request_key,
 replace(canonical,'fictional-policy-v1','fictional-policy-v2')),
 '23514','Request key conflicts with existing admission','Changed policy conflicts with same key')
 from fixture_requests where name='manual';
select throws_ok(format('select terra_private.admit_update_run(%L,%L)',request_key,canonical),
 '23514','Scheduled request is not due','Future valid window is not admitted early')
 from fixture_requests where name='scheduled-2027-1';
select lives_ok(format('select terra_private.admit_update_run(%L,%L)',request_key,canonical),
 'Past Oslo winter due window is admitted') from fixture_requests where name='scheduled-2026-2';
select lives_ok(format('select terra_private.admit_update_run(%L,%L)',request_key,canonical),
 'Past Oslo summer due window is admitted') from fixture_requests where name='scheduled-2026-40';

select throws_ok($$update terra_private.update_runs set requested_by='runner:other'
 where request_key='fictional:admission:v1'$$,'23514','Admitted run identity is immutable',
 'Actor cannot change after admission');
select throws_ok($$update terra_private.update_runs set mode='publish_eligible'
 where request_key='fictional:admission:v1'$$,'23514','Admitted run identity is immutable',
 'Mode cannot expand after admission');
select throws_ok($$update terra_private.update_runs set limits='{}'
 where request_key='fictional:admission:v1'$$,'23514','Admitted run identity is immutable',
 'Limits cannot disappear after admission');
select throws_ok($$update terra_private.update_runs set request_fingerprint=repeat('a',64)
 where request_key='fictional:admission:v1'$$,'23514','Admitted run identity is immutable',
 'Fingerprint cannot change after admission');
select throws_ok($$update terra_private.update_runs set request_key='fictional:renamed'
 where request_key='fictional:admission:v1'$$,'23514','Admitted run identity is immutable',
 'Request key cannot change after admission');
select throws_ok($$update terra_private.update_run_requests set canonical_request='{}'$$,
 '23514','Automatic decision records are append-only','Canonical admission is immutable');
select throws_ok($$delete from terra_private.update_run_requests$$,
 '23514','Automatic decision records are append-only','Admission history cannot be removed');
select lives_ok($$update terra_private.update_runs set run_state='completed',finished_at=clock_timestamp()
 where request_key='fictional:admission:v1'$$,'Existing owner can progress run state');
select is(terra_private.admit_update_run(request_key,canonical)->>'runState','completed',
 'Retry reports completed state without starting again') from fixture_requests where name='manual';

insert into terra_private.update_runs(request_key,request_fingerprint,jurisdiction_id,requested_by,mode)
 values('fictional:legacy',repeat('b',64),'fictional-country','runner:fictional','shadow');
select throws_ok(format('select terra_private.admit_update_run(%L,%L)','fictional:legacy',canonical),
 '23514','Request key conflicts with existing admission','Unadmitted legacy run is not silently adopted')
 from fixture_requests where name='manual';
select throws_ok($$insert into terra_private.update_run_requests(run_id,canonical_request)
 select r.id,f.canonical from terra_private.update_runs r,fixture_requests f
 where r.request_key='fictional:legacy' and f.name='manual'$$,
 '23514','Admission does not match queued run','Direct admission must match exact run fields');

create function pg_temp.inject_admission_failure() returns trigger language plpgsql as $test$
begin raise exception 'Fictional injected admission failure' using errcode='23514'; end;
$test$;
create trigger fictional_admission_failure before insert on terra_private.update_run_requests
 for each row execute function pg_temp.inject_admission_failure();
select throws_ok(format('select terra_private.admit_update_run(%L,%L)','fictional:late-failure',canonical),
 '23514','Fictional injected admission failure','Late admission failure rolls back queued run')
 from fixture_requests where name='manual';
select is((select count(*) from terra_private.update_runs where request_key='fictional:late-failure'),
 0::bigint,'Late failure leaves no orphan run');
select is((select count(*) from terra_private.issue_publications),0::bigint,'Admission creates no publication');
select * from finish();
rollback;
