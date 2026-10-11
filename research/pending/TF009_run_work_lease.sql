-- Owner-only candidate built on the pending admission draft. No runtime grant.
-- Fixed 30-second work leases; the admitted duration bounds the entire run.

create table terra_private.update_run_work_claims (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references terra_private.update_runs(id),
  attempt_key uuid not null,
  attempt_no integer not null check(attempt_no between 1 and 6),
  claimed_at timestamptz not null check(isfinite(claimed_at)),
  initial_expires_at timestamptz not null check(isfinite(initial_expires_at)),
  unique(id,run_id), unique(run_id,attempt_no), unique(run_id,attempt_key),
  check(initial_expires_at>claimed_at and initial_expires_at<=claimed_at+interval '30 seconds')
);
create table terra_private.update_run_work_state (
  run_id uuid primary key references terra_private.update_runs(id),
  claim_id uuid not null unique,
  started_at timestamptz not null check(isfinite(started_at)),
  deadline_at timestamptz not null check(isfinite(deadline_at)),
  lease_expires_at timestamptz not null check(isfinite(lease_expires_at)),
  updated_at timestamptz not null check(isfinite(updated_at)),
  foreign key(claim_id,run_id) references terra_private.update_run_work_claims(id,run_id),
  check(started_at<lease_expires_at and lease_expires_at<=deadline_at),
  check(updated_at>=started_at and updated_at<lease_expires_at)
);
alter table terra_private.update_run_work_claims enable row level security;
alter table terra_private.update_run_work_state enable row level security;
revoke all on terra_private.update_run_work_claims,terra_private.update_run_work_state
 from public,anon,authenticated,service_role,terra_collector,terra_operator,
      terra_reviewer,terra_issue_reader;
grant select on terra_private.update_run_work_claims,terra_private.update_run_work_state
 to terra_operator,terra_reviewer;
create policy operator_read on terra_private.update_run_work_claims for select to terra_operator using(true);
create policy reviewer_read on terra_private.update_run_work_claims for select to terra_reviewer using(true);
create policy operator_read on terra_private.update_run_work_state for select to terra_operator using(true);
create policy reviewer_read on terra_private.update_run_work_state for select to terra_reviewer using(true);
create trigger update_run_work_claim_immutable before update or delete
 on terra_private.update_run_work_claims for each row
 execute function terra_private.block_automatic_decision_change();
create trigger update_run_work_state_no_delete before delete
 on terra_private.update_run_work_state for each row
 execute function terra_private.block_automatic_decision_change();

create function terra_private.check_update_run_work_claim_insert()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare
 r terra_private.update_runs%rowtype;
 w terra_private.update_run_work_state%rowtype;
 prior_attempt integer;
 admitted_at timestamptz;
begin
 select * into r from terra_private.update_runs where id=new.run_id for update;
 select a.admitted_at into admitted_at from terra_private.update_run_requests a where run_id=r.id;
 select * into w from terra_private.update_run_work_state where run_id=r.id for update;
 select coalesce(max(attempt_no),0) into prior_attempt from terra_private.update_run_work_claims where run_id=r.id;
 if r.id is null or admitted_at is null or r.run_state not in('queued','running')
    or new.attempt_no<>prior_attempt+1
    or new.attempt_no>(r.limits->>'max_retries')::integer+1
    or new.claimed_at<admitted_at or new.claimed_at>clock_timestamp()
    or (w.run_id is not null and
        (new.claimed_at<w.lease_expires_at or new.claimed_at>=w.deadline_at
         or new.initial_expires_at>w.deadline_at)) then
   raise exception 'Work claim is invalid' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger update_run_work_claim_insert_guard before insert
 on terra_private.update_run_work_claims for each row
 execute function terra_private.check_update_run_work_claim_insert();

create function terra_private.check_update_run_work_state_change()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare
 r terra_private.update_runs%rowtype;
 c terra_private.update_run_work_claims%rowtype;
 previous_attempt integer;
begin
 select * into r from terra_private.update_runs where id=new.run_id for update;
 select * into c from terra_private.update_run_work_claims where id=new.claim_id and run_id=r.id;
 if c.id is null or r.run_state<>'running' or new.updated_at>clock_timestamp()
    or new.lease_expires_at>new.updated_at+interval '30 seconds' then
   raise exception 'Work state is invalid' using errcode='23514';
 end if;
 if tg_op='INSERT' then
   if c.attempt_no<>1 or new.started_at<>c.claimed_at or new.updated_at<>c.claimed_at
      or new.lease_expires_at<>c.initial_expires_at
      or new.deadline_at<>new.started_at+(r.limits->>'max_duration_seconds')::integer*interval '1 second' then
     raise exception 'Work state is invalid' using errcode='23514';
   end if;
 else
   if row(new.run_id,new.started_at,new.deadline_at) is distinct from
      row(old.run_id,old.started_at,old.deadline_at)
      or new.updated_at<old.updated_at or new.lease_expires_at<old.lease_expires_at then
     raise exception 'Work state is invalid' using errcode='23514';
   end if;
   if new.claim_id<>old.claim_id then
     select attempt_no into previous_attempt from terra_private.update_run_work_claims where id=old.claim_id;
     if c.attempt_no<>previous_attempt+1 or new.updated_at<>c.claimed_at
        or new.updated_at<old.lease_expires_at or new.updated_at>=old.deadline_at
        or new.lease_expires_at<>c.initial_expires_at then
       raise exception 'Work state is invalid' using errcode='23514';
     end if;
   elsif new.updated_at>=old.lease_expires_at or new.updated_at>=old.deadline_at then
     raise exception 'Work state is invalid' using errcode='23514';
   end if;
 end if;
 return new;
end;
$guard$;
create trigger update_run_work_state_guard before insert or update
 on terra_private.update_run_work_state for each row
 execute function terra_private.check_update_run_work_state_change();

create function terra_private.check_update_run_work_claim_selected()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
begin
 if not exists(select 1 from terra_private.update_run_work_state w
    join terra_private.update_run_work_claims c on c.id=w.claim_id and c.run_id=w.run_id
    where w.run_id=new.run_id and c.attempt_no>=new.attempt_no) then
   raise exception 'Work claim has no selected state' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create constraint trigger update_run_work_claim_selection_guard
after insert on terra_private.update_run_work_claims
deferrable initially deferred for each row
execute function terra_private.check_update_run_work_claim_selected();

create function terra_private.claim_update_run_work(p_run uuid,p_fingerprint text,p_attempt uuid)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $claim$
declare
 r terra_private.update_runs%rowtype;
 w terra_private.update_run_work_state%rowtype;
 c terra_private.update_run_work_claims%rowtype;
 now_at timestamptz;
 started timestamptz;
 deadline timestamptz;
 expires timestamptz;
 next_attempt integer;
 status text;
begin
 if p_run is null or p_attempt is null or p_fingerprint is null
    or p_fingerprint !~ '^[0-9a-f]{64}$' then
   raise exception 'Work request is invalid' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=p_run for update;
 if r.id is null or r.request_fingerprint is distinct from p_fingerprint
    or not exists(select 1 from terra_private.update_run_requests where run_id=r.id) then
   raise exception 'Work request is invalid' using errcode='23514';
 end if;
 select * into w from terra_private.update_run_work_state where run_id=r.id for update;
 now_at:=clock_timestamp();
 if r.run_state not in('queued','running') then
   return jsonb_build_object('schemaVersion',1,'status','finished','runId',r.id);
 end if;
 if w.run_id is not null and r.run_state<>'running' then
   raise exception 'Work request is invalid' using errcode='23514';
 end if;
 select * into c from terra_private.update_run_work_claims where run_id=r.id and attempt_key=p_attempt;
 if c.id is not null then
   if c.id is distinct from w.claim_id or now_at>=w.lease_expires_at or now_at>=w.deadline_at then
     return jsonb_build_object('schemaVersion',1,'status','stale_claim','runId',r.id);
   end if;
   status:='existing_claim';
 else
   if w.run_id is not null and now_at>=w.deadline_at then
     return jsonb_build_object('schemaVersion',1,'status','deadline_reached','runId',r.id);
   end if;
   if w.run_id is not null and now_at<w.lease_expires_at then
     return jsonb_build_object('schemaVersion',1,'status','busy','runId',r.id);
   end if;
   select coalesce(max(attempt_no),0)+1 into next_attempt
     from terra_private.update_run_work_claims where run_id=r.id;
   if next_attempt>(r.limits->>'max_retries')::integer+1 then
     return jsonb_build_object('schemaVersion',1,'status','attempt_limit','runId',r.id);
   end if;
   started:=coalesce(w.started_at,now_at);
   deadline:=coalesce(w.deadline_at,started+(r.limits->>'max_duration_seconds')::integer*interval '1 second');
   expires:=least(now_at+interval '30 seconds',deadline);
   insert into terra_private.update_run_work_claims(run_id,attempt_key,attempt_no,claimed_at,initial_expires_at)
     values(r.id,p_attempt,next_attempt,now_at,expires) returning * into c;
   update terra_private.update_runs set run_state='running' where id=r.id;
   if w.run_id is null then
     insert into terra_private.update_run_work_state(run_id,claim_id,started_at,deadline_at,lease_expires_at,updated_at)
       values(r.id,c.id,started,deadline,expires,now_at) returning * into w;
   else
     -- The run row is already locked. An upsert would fire the first-insert
     -- guard before its conflict update and reject a legitimate takeover.
     update terra_private.update_run_work_state set claim_id=c.id,
       lease_expires_at=expires,updated_at=now_at where run_id=r.id returning * into w;
   end if;
   status:='claimed';
 end if;
 return jsonb_build_object('schemaVersion',1,'status',status,'runId',r.id,'leaseId',c.id,
   'attempt',c.attempt_no,'leaseExpiresAt',w.lease_expires_at,'deadlineAt',w.deadline_at,
   'observedAt',now_at);
end;
$claim$;

create function terra_private.assert_update_run_work(p_run uuid,p_fingerprint text,p_lease uuid)
returns void language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $assert$
declare r terra_private.update_runs%rowtype;
declare w terra_private.update_run_work_state%rowtype;
begin
 select * into r from terra_private.update_runs where id=p_run for update;
 select * into w from terra_private.update_run_work_state where run_id=r.id for update;
 if r.id is null or w.run_id is null or p_lease is null
    or r.request_fingerprint is distinct from p_fingerprint
    or r.run_state<>'running' or w.claim_id is distinct from p_lease
    or clock_timestamp()>=w.lease_expires_at or clock_timestamp()>=w.deadline_at then
   raise exception 'Work lease is not current' using errcode='23514';
 end if;
end;
$assert$;

create function terra_private.renew_update_run_work(p_run uuid,p_fingerprint text,p_lease uuid)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $renew$
declare w terra_private.update_run_work_state%rowtype;
declare now_at timestamptz;
begin
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_lease);
 now_at:=clock_timestamp();
 update terra_private.update_run_work_state set updated_at=now_at,
    lease_expires_at=least(now_at+interval '30 seconds',deadline_at)
    where run_id=p_run returning * into w;
 return jsonb_build_object('schemaVersion',1,'status','renewed','runId',p_run,
     'leaseId',p_lease,'leaseExpiresAt',w.lease_expires_at,'deadlineAt',w.deadline_at,
     'observedAt',now_at);
end;
$renew$;

revoke all on function terra_private.check_update_run_work_claim_insert(),
 terra_private.check_update_run_work_state_change(),
 terra_private.check_update_run_work_claim_selected(),
 terra_private.claim_update_run_work(uuid,text,uuid),
 terra_private.assert_update_run_work(uuid,text,uuid),
 terra_private.renew_update_run_work(uuid,text,uuid)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,
      terra_reviewer,terra_issue_reader;
