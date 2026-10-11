\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table lease_templates(name text primary key,canonical text not null);
insert into lease_templates values ('standard','{"actor_id":"runner:fictional","code_version":"local-rehearsal-v1","limits":{"max_duration_seconds":300,"max_items":30,"max_model_calls":0,"max_model_input_tokens":0,"max_model_output_tokens":0,"max_response_bytes":2000000,"max_retries":1,"month_cap_usd":"0","run_cap_usd":"0"},"mode":"shadow","policy_version":"fictional-policy-v1","scheduled_due_at":null,"scope":"fictional-lease-country","strategy":"incremental","trigger":"manual"}'),('short','{"actor_id":"runner:fictional","code_version":"local-rehearsal-v1","limits":{"max_duration_seconds":1,"max_items":30,"max_model_calls":0,"max_model_input_tokens":0,"max_model_output_tokens":0,"max_response_bytes":2000000,"max_retries":1,"month_cap_usd":"0","run_cap_usd":"0"},"mode":"shadow","policy_version":"fictional-policy-v1","scheduled_due_at":null,"scope":"fictional-lease-country","strategy":"incremental","trigger":"manual"}');
insert into terra_private.jurisdictions(id,display_name)
 values('fictional-lease-country','Fictional lease place');

create function pg_temp.seed_work_run(k text,age_seconds integer default 0,
                                    attempts integer default 0,template text default 'standard')
returns uuid language plpgsql as $seed$
declare
 canonical text;
 p jsonb;
 r_id uuid;
 c_id uuid;
 base timestamptz:=clock_timestamp()-age_seconds*interval '1 second';
 start_at timestamptz:=base+interval '2 seconds';
 claim_at timestamptz;
 deadline timestamptz;
 expires timestamptz;
 n integer;
begin
 select t.canonical into canonical from lease_templates t where name=template;
 p:=terra_private.validate_update_request(k,canonical);
 insert into terra_private.update_runs(request_key,request_fingerprint,jurisdiction_id,
  requested_by,mode,code_version,policy_version,limits,created_at)
 values(k,encode(sha256(convert_to(canonical,'UTF8')),'hex'),p->>'scope',p->>'actor_id',
  p->>'mode',p->>'code_version',p->>'policy_version',p->'limits',base) returning id into r_id;
 insert into terra_private.update_run_requests(run_id,canonical_request,admitted_at)
 values(r_id,canonical,base);
 if attempts>0 then
   update terra_private.update_runs set run_state='running' where id=r_id;
   deadline:=start_at+(p #>> '{limits,max_duration_seconds}')::integer*interval '1 second';
   for n in 1..attempts loop
     claim_at:=start_at+(n-1)*interval '30 seconds';
     expires:=least(claim_at+interval '30 seconds',deadline);
     insert into terra_private.update_run_work_claims(run_id,attempt_key,attempt_no,claimed_at,initial_expires_at)
     values(r_id,gen_random_uuid(),n,claim_at,expires) returning id into c_id;
     if n=1 then
       insert into terra_private.update_run_work_state(run_id,claim_id,started_at,deadline_at,lease_expires_at,updated_at)
       values(r_id,c_id,start_at,deadline,expires,claim_at);
     else
       update terra_private.update_run_work_state set claim_id=c_id,
         lease_expires_at=expires,updated_at=claim_at where run_id=r_id;
     end if;
   end loop;
 end if;
 return r_id;
end;
$seed$;

select ok(c.relrowsecurity,c.relname||' has RLS') from pg_class c
 where c.oid in('terra_private.update_run_work_claims'::regclass,'terra_private.update_run_work_state'::regclass);
select ok(not has_function_privilege(role_name,fn,'EXECUTE'),role_name||' cannot invoke '||fn)
 from unnest(array['anon','authenticated','service_role','terra_collector','terra_operator',
                   'terra_reviewer','terra_issue_reader']) roles(role_name),
 unnest(array['terra_private.claim_update_run_work(uuid,text,uuid)',
              'terra_private.renew_update_run_work(uuid,text,uuid)',
              'terra_private.assert_update_run_work(uuid,text,uuid)']) funcs(fn);
select ok(not p.prosecdef,p.proname||' preserves invoker authority') from pg_proc p
 where p.oid in('terra_private.claim_update_run_work(uuid,text,uuid)'::regprocedure,
 'terra_private.renew_update_run_work(uuid,text,uuid)'::regprocedure,
 'terra_private.assert_update_run_work(uuid,text,uuid)'::regprocedure);

create temporary table lease_results(name text primary key,run_id uuid,first_claim jsonb,second_claim jsonb);
insert into lease_results(name,run_id) values('normal',pg_temp.seed_work_run('fictional:lease:normal'));
update lease_results set first_claim=terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),
 '11111111-1111-4111-8111-111111111111') where name='normal';
select is(first_claim->>'status','claimed','First worker obtains the lease') from lease_results where name='normal';
select is(first_claim->>'attempt','1','First lease consumes one attempt') from lease_results where name='normal';
select is((select run_state from terra_private.update_runs where id=run_id),'running',
 'Claim starts queued run') from lease_results where name='normal';
select ok(w.lease_expires_at<=w.updated_at+interval '30 seconds' and w.lease_expires_at<=w.deadline_at,
 'Lease is capped by both fixed TTL and run deadline') from terra_private.update_run_work_state w
 join lease_results f using(run_id) where f.name='normal';
select is(w.deadline_at-w.started_at,interval '300 seconds','Deadline comes from admitted duration')
 from terra_private.update_run_work_state w join lease_results f using(run_id) where f.name='normal';
update lease_results set second_claim=terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),
 '11111111-1111-4111-8111-111111111111') where name='normal';
select is(second_claim->>'status','existing_claim','Same attempt resumes same live lease') from lease_results where name='normal';
select is(second_claim->>'leaseId',first_claim->>'leaseId','Lost-response retry preserves lease ID')
 from lease_results where name='normal';
select is(terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid())->>'status',
 'busy','Different worker cannot take a live lease') from lease_results where name='normal';
select ok(not (terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid()) ? 'leaseId'),
 'Busy response exposes no current lease') from lease_results where name='normal';
select lives_ok(format('select terra_private.assert_update_run_work(%L,%L,%L)',run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),first_claim->>'leaseId'),
 'Current lease passes fencing check') from lease_results where name='normal';
select is(terra_private.renew_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),
 (first_claim->>'leaseId')::uuid)->>'status','renewed','Current holder can renew')
 from lease_results where name='normal';
select is((select count(*) from terra_private.update_run_work_claims where run_id=f.run_id),1::bigint,
 'Renewal does not spend another retry') from lease_results f where name='normal';
select throws_ok(format('select terra_private.assert_update_run_work(%L,%L,%L)',run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid()),
 '23514','Work lease is not current','Foreign lease cannot write') from lease_results where name='normal';
select throws_ok(format('select terra_private.claim_update_run_work(%L,%L,%L)',run_id,repeat('a',64),gen_random_uuid()),
 '23514','Work request is invalid','Changed fingerprint cannot claim work') from lease_results where name='normal';
select throws_ok($$select terra_private.claim_update_run_work(null,null,null)$$,
 '23514','Work request is invalid','Null work request fails closed');

insert into lease_results(name,run_id) values('takeover',pg_temp.seed_work_run('fictional:lease:takeover',40,1));
update lease_results set first_claim=(select jsonb_build_object('leaseId',c.id,'attemptKey',c.attempt_key,
 'startedAt',w.started_at,'deadlineAt',w.deadline_at) from terra_private.update_run_work_state w
 join terra_private.update_run_work_claims c on c.id=w.claim_id where w.run_id=lease_results.run_id)
 where name='takeover';
update lease_results set second_claim=terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid()) where name='takeover';
select is(second_claim->>'status','claimed','Expired holder can be replaced within total deadline')
 from lease_results where name='takeover';
select is(second_claim->>'attempt','2','Takeover consumes the permitted retry') from lease_results where name='takeover';
select ok(second_claim->>'leaseId'<>first_claim->>'leaseId','Takeover creates a new fencing ID')
 from lease_results where name='takeover';
select is(w.started_at,(f.first_claim->>'startedAt')::timestamptz,'Takeover cannot restart total duration')
 from terra_private.update_run_work_state w join lease_results f using(run_id) where f.name='takeover';
select is(w.deadline_at,(f.first_claim->>'deadlineAt')::timestamptz,'Takeover keeps original deadline')
 from terra_private.update_run_work_state w join lease_results f using(run_id) where f.name='takeover';
select throws_ok(format('select terra_private.assert_update_run_work(%L,%L,%L)',run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),first_claim->>'leaseId'),
 '23514','Work lease is not current','Previous holder is fenced after takeover') from lease_results where name='takeover';
select throws_ok(format('select terra_private.renew_update_run_work(%L,%L,%L)',run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),first_claim->>'leaseId'),
 '23514','Work lease is not current','Previous holder cannot renew after takeover') from lease_results where name='takeover';
select is(terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),
 (first_claim->>'attemptKey')::uuid)->>'status','stale_claim','Old attempt key cannot claim current work')
 from lease_results where name='takeover';

insert into lease_results(name,run_id) values('exhausted',pg_temp.seed_work_run('fictional:lease:exhausted',80,2));
select is(terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid())->>'status',
 'attempt_limit','Expired final attempt cannot expand retry ceiling') from lease_results where name='exhausted';
insert into lease_results(name,run_id) values('deadline',pg_temp.seed_work_run('fictional:lease:deadline',360,1));
select is(terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid())->>'status',
 'deadline_reached','Expired whole-run deadline cannot be renewed through takeover') from lease_results where name='deadline';
insert into lease_results(name,run_id) values('short',pg_temp.seed_work_run('fictional:lease:short',0,0,'short'));
update lease_results set first_claim=terra_private.claim_update_run_work(run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid()) where name='short';
select is(w.lease_expires_at,w.deadline_at,'Short admitted duration caps lease below 30 seconds')
 from terra_private.update_run_work_state w join lease_results f using(run_id) where f.name='short';

select throws_ok($$update terra_private.update_run_work_claims set attempt_no=6$$,
 '23514','Automatic decision records are append-only','Attempt history cannot be rewritten');
select throws_ok($$delete from terra_private.update_run_work_state$$,
 '23514','Automatic decision records are append-only','Work state cannot be removed to reset budget');
select throws_ok($$update terra_private.update_run_work_state set deadline_at=deadline_at+interval '1 day'$$,
 '23514','Work state is invalid','Total run deadline cannot expand');

create function pg_temp.inject_work_failure() returns trigger language plpgsql as $fail$
begin raise exception 'Fictional late work failure' using errcode='23514'; end;
$fail$;
create trigger fictional_work_failure before insert on terra_private.update_run_work_state
 for each row execute function pg_temp.inject_work_failure();
insert into lease_results(name,run_id) values('late-failure',pg_temp.seed_work_run('fictional:lease:late-failure'));
select throws_ok(format('select terra_private.claim_update_run_work(%L,%L,%L)',run_id,
 (select request_fingerprint from terra_private.update_runs where id=run_id),gen_random_uuid()),
 '23514','Fictional late work failure','Failure after claim insert rolls back work acquisition')
 from lease_results where name='late-failure';
select is((select run_state from terra_private.update_runs where id=run_id),'queued',
 'Late failure leaves original run queued') from lease_results where name='late-failure';
select is((select count(*) from terra_private.update_run_work_claims where run_id=f.run_id),0::bigint,
 'Late failure leaves no orphan attempt') from lease_results f where name='late-failure';
drop trigger fictional_work_failure on terra_private.update_run_work_state;
create function pg_temp.insert_orphan_work_claim(r_id uuid) returns void language plpgsql as $orphan$
begin
 insert into terra_private.update_run_work_claims(run_id,attempt_key,attempt_no,claimed_at,initial_expires_at)
 values(r_id,gen_random_uuid(),1,clock_timestamp(),clock_timestamp()+interval '10 seconds');
 set constraints terra_private.update_run_work_claim_selection_guard immediate;
end;
$orphan$;
select throws_ok(format('select pg_temp.insert_orphan_work_claim(%L)',run_id),
 '23514','Work claim has no selected state','Deferred guard blocks an orphan committed claim')
 from lease_results where name='late-failure';
set constraints terra_private.update_run_work_claim_selection_guard immediate;
select pass('Deferred claim selection checks run successfully before rollback');
select is((select count(*) from terra_private.issue_publications),0::bigint,'Leases publish nothing');
select * from finish();
rollback;
