-- David explicitly approved this combined local bundle on 2026-09-30.
-- Four private tables, 23 fields, fourteen invoker functions, twelve triggers.
-- No application writer, source fetch, schedule or real publication enabled.
begin;
-- Owner-only development candidate. No production writer or schedule is granted.
-- Deliberately outside migrations until separately reviewed and authorized.
-- Apply inside a caller-owned rollback transaction, or a disposable test database.

create function terra_private.validate_update_request(p_key text, p_canonical text)
returns jsonb
language plpgsql stable security invoker
set search_path = pg_catalog, pg_temp
as $validate$
declare
  p jsonb;
  limits jsonb;
  k text;
  canonical_limits text;
  canonical_root text;
  due_at timestamptz;
  oslo_due timestamp;
begin
  if p_key is null or p_key !~ '^[a-z0-9][a-z0-9:_-]{0,159}$'
     or p_canonical is null or octet_length(p_canonical) not between 2 and 4096 then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  p := p_canonical::jsonb;
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  if (select array_agg(key order by key collate "C") from jsonb_each(p)) is distinct from
    array['actor_id','code_version','limits','mode','policy_version','scheduled_due_at',
          'scope','strategy','trigger']::text[] then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  foreach k in array array['actor_id','code_version','policy_version'] loop
    if jsonb_typeof(p->k) is distinct from 'string'
       or p->>k !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,119}$' then
      raise exception 'Update request is invalid' using errcode='23514';
    end if;
  end loop;
  if jsonb_typeof(p->'scope') is distinct from 'string'
     or p->>'scope' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(p->>'scope') > 80
     or jsonb_typeof(p->'mode') is distinct from 'string'
     or p->>'mode' not in ('shadow','publish_eligible')
     or jsonb_typeof(p->'strategy') is distinct from 'string'
     or p->>'strategy' not in ('incremental','reconcile')
     or jsonb_typeof(p->'trigger') is distinct from 'string'
     or p->>'trigger' not in ('manual','scheduled') then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  limits := p->'limits';
  if jsonb_typeof(limits) is distinct from 'object' then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  if (select array_agg(key order by key collate "C") from jsonb_each(limits)) is distinct from
    array['max_duration_seconds','max_items','max_model_calls','max_model_input_tokens',
          'max_model_output_tokens','max_response_bytes','max_retries','month_cap_usd',
          'run_cap_usd']::text[] then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  foreach k in array array['max_duration_seconds','max_items','max_model_calls',
                           'max_model_input_tokens','max_model_output_tokens',
                           'max_response_bytes','max_retries'] loop
    if jsonb_typeof(limits->k) is distinct from 'number'
       or limits->>k !~ '^(0|[1-9][0-9]{0,7})$' then
      raise exception 'Update request is invalid' using errcode='23514';
    end if;
  end loop;
  foreach k in array array['month_cap_usd','run_cap_usd'] loop
    if jsonb_typeof(limits->k) is distinct from 'string'
       or limits->>k !~ '^(0|[1-9][0-9]{0,6})(\.[0-9]{0,8}[1-9])?$'
       or (limits->>k)::numeric > 1000000 then
      raise exception 'Update request is invalid' using errcode='23514';
    end if;
  end loop;
  if (limits->>'max_items')::integer not between 1 and 50
     or (limits->>'max_duration_seconds')::integer not between 1 and 3600
     or (limits->>'max_response_bytes')::integer not between 1 and 50000000
     or (limits->>'max_model_calls')::integer > 1000
     or (limits->>'max_model_input_tokens')::integer > 1000000
     or (limits->>'max_model_output_tokens')::integer > 1000000
     or (limits->>'max_retries')::integer > 5
     or ((limits->>'max_model_calls')::integer > 0 and
         ((limits->>'max_model_input_tokens')::integer = 0
          or (limits->>'max_model_output_tokens')::integer = 0
          or (limits->>'run_cap_usd')::numeric = 0
          or (limits->>'month_cap_usd')::numeric = 0))
     or ((limits->>'max_model_calls')::integer = 0 and
         ((limits->>'max_model_input_tokens')::integer <> 0
          or (limits->>'max_model_output_tokens')::integer <> 0)) then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  if p->>'trigger' = 'manual' then
    if p->'scheduled_due_at' is distinct from 'null'::jsonb then
      raise exception 'Update request is invalid' using errcode='23514';
    end if;
  else
    if jsonb_typeof(p->'scheduled_due_at') is distinct from 'string'
       or p->>'scheduled_due_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00:00\+00:00$' then
      raise exception 'Update request is invalid' using errcode='23514';
    end if;
    due_at := (p->>'scheduled_due_at')::timestamptz;
    oslo_due := due_at at time zone 'Europe/Oslo';
    if not isfinite(due_at) or extract(isodow from oslo_due) <> 1
       or extract(hour from oslo_due) <> 8
       or p_key <> 'weekly:' || to_char(oslo_due,'IYYY"w"IW') || ':' || (p->>'scope') then
      raise exception 'Update request is invalid' using errcode='23514';
    end if;
  end if;
  -- Every allowed leaf is bounded ASCII text, an integer, or JSON null.
  -- Rebuilding both levels rejects whitespace, duplicate keys and alternate
  -- number spellings. These are exactly Python's sorted compact JSON bytes.
  select '{' || string_agg(to_jsonb(key)::text || ':' || value::text, ','
                          order by key collate "C") || '}'
    into canonical_limits from jsonb_each(limits);
  select '{' || string_agg(to_jsonb(key)::text || ':' ||
      case when key='limits' then canonical_limits else value::text end, ','
      order by key collate "C") || '}'
    into canonical_root from jsonb_each(p);
  if canonical_root is distinct from p_canonical then
    raise exception 'Update request is invalid' using errcode='23514';
  end if;
  return p;
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'Update request is invalid' using errcode='23514';
end;
$validate$;

create table terra_private.update_run_requests (
  run_id uuid primary key references terra_private.update_runs(id),
  canonical_request text not null check (octet_length(canonical_request) between 2 and 4096),
  admitted_at timestamptz not null default clock_timestamp() check (isfinite(admitted_at))
);
alter table terra_private.update_run_requests enable row level security;
revoke all on terra_private.update_run_requests from public, anon, authenticated,
  service_role, terra_collector, terra_operator, terra_reviewer, terra_issue_reader;
grant select on terra_private.update_run_requests to terra_reviewer, terra_operator;
create policy reviewer_read on terra_private.update_run_requests
  for select to terra_reviewer using (true);
create policy operator_read on terra_private.update_run_requests
  for select to terra_operator using (true);
create trigger update_run_request_immutable
before update or delete on terra_private.update_run_requests
for each row execute function terra_private.block_automatic_decision_change();

create function terra_private.check_update_run_request_insert()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $guard$
declare r terra_private.update_runs%rowtype;
declare p jsonb;
begin
  select * into r from terra_private.update_runs where id=new.run_id for update;
  if not found then
    raise exception 'Admission run is missing' using errcode='23503';
  end if;
  p := terra_private.validate_update_request(r.request_key,new.canonical_request);
  if r.request_fingerprint is distinct from
       encode(sha256(convert_to(new.canonical_request,'UTF8')),'hex')
     or r.jurisdiction_id is distinct from p->>'scope'
     or r.requested_by is distinct from p->>'actor_id'
     or r.mode is distinct from p->>'mode'
     or r.code_version is distinct from p->>'code_version'
     or r.policy_version is distinct from p->>'policy_version'
     or r.limits is distinct from p->'limits'
     or r.run_state <> 'queued' or r.commit_state <> 'none'
     or r.visibility_state <> 'not_required' or r.finished_at is not null
     or not isfinite(r.created_at) or new.admitted_at < r.created_at
     or new.admitted_at > clock_timestamp()
     or (p->>'trigger'='scheduled' and
         (p->>'scheduled_due_at')::timestamptz > new.admitted_at) then
    raise exception 'Admission does not match queued run' using errcode='23514';
  end if;
  return new;
end;
$guard$;
create trigger update_run_request_insert_guard
before insert on terra_private.update_run_requests
for each row execute function terra_private.check_update_run_request_insert();

create function terra_private.check_admitted_run_identity_change()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $guard$
begin
  if exists(select 1 from terra_private.update_run_requests where run_id=old.id)
     and row(new.id,new.request_key,new.request_fingerprint,new.jurisdiction_id,
             new.requested_by,new.mode,new.code_version,new.policy_version,new.limits,new.created_at)
       is distinct from row(old.id,old.request_key,old.request_fingerprint,old.jurisdiction_id,
             old.requested_by,old.mode,old.code_version,old.policy_version,old.limits,old.created_at) then
    raise exception 'Admitted run identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$guard$;
create trigger admitted_run_identity_guard before update on terra_private.update_runs
for each row execute function terra_private.check_admitted_run_identity_change();

create function terra_private.admit_update_run(p_key text,p_canonical text)
returns jsonb
language plpgsql volatile security invoker
set search_path = pg_catalog, pg_temp
as $admit$
declare
  p jsonb;
  fingerprint text;
  r terra_private.update_runs%rowtype;
  saved_request text;
  inserted_id uuid;
begin
  p := terra_private.validate_update_request(p_key,p_canonical);
  fingerprint := encode(sha256(convert_to(p_canonical,'UTF8')),'hex');
  if p->>'trigger'='scheduled'
     and (p->>'scheduled_due_at')::timestamptz > clock_timestamp() then
    raise exception 'Scheduled request is not due' using errcode='23514';
  end if;
  -- The unique index waits for a concurrent insert before DO NOTHING.
  -- The subsequent locked SELECT has a fresh READ COMMITTED snapshot.
  insert into terra_private.update_runs
    (request_key,request_fingerprint,jurisdiction_id,requested_by,mode,
     code_version,policy_version,limits)
    values (p_key,fingerprint,p->>'scope',p->>'actor_id',p->>'mode',
            p->>'code_version',p->>'policy_version',p->'limits')
    on conflict(request_key) do nothing returning id into inserted_id;
  select * into r from terra_private.update_runs where request_key=p_key for update;
  if not found then
    raise exception 'Admission retry required' using errcode='40001';
  end if;
  if inserted_id is not null then
    insert into terra_private.update_run_requests(run_id,canonical_request)
      values(r.id,p_canonical);
  else
    select canonical_request into saved_request from terra_private.update_run_requests
      where run_id=r.id;
    if r.request_fingerprint is distinct from fingerprint
       or saved_request is distinct from p_canonical then
      raise exception 'Request key conflicts with existing admission' using errcode='23514';
    end if;
  end if;
  return jsonb_build_object('schemaVersion',1,'status',
     case when inserted_id is null then 'existing' else 'admitted' end,
     'runId',r.id,'requestKey',r.request_key,'requestFingerprint',r.request_fingerprint,
     'runState',r.run_state,'commitState',r.commit_state,'visibilityState',r.visibility_state);
end;
$admit$;

revoke all on function terra_private.validate_update_request(text,text),
  terra_private.check_update_run_request_insert(),
  terra_private.check_admitted_run_identity_change(),
  terra_private.admit_update_run(text,text)
  from public, anon, authenticated, service_role, terra_collector,
       terra_reviewer, terra_operator, terra_issue_reader;

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

-- Owner-only atomic activation candidate; requires the pending admission and
-- work lease controls. No app writer, source, credential or schedule is granted.

create table terra_private.machine_publication_activations (
 publication_id uuid primary key references terra_private.issue_publications(id),
 decision_id uuid not null unique references terra_private.machine_candidate_decisions(id),
 run_id uuid not null references terra_private.update_runs(id),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 expected_head uuid references terra_private.issue_publications(id),
 request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
 publication_sha256 text not null check(publication_sha256~'^[0-9a-f]{64}$'),
 activated_at timestamptz not null default clock_timestamp() check(isfinite(activated_at))
);
create index machine_activations_run_idx on terra_private.machine_publication_activations(run_id,activated_at);
create index machine_activations_work_claim_idx on terra_private.machine_publication_activations(work_claim_id);
create index machine_activations_predecessor_idx on terra_private.machine_publication_activations(expected_head)
 where expected_head is not null;
alter table terra_private.machine_publication_activations enable row level security;
revoke all on terra_private.machine_publication_activations from public,anon,authenticated,
 service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
grant select on terra_private.machine_publication_activations to terra_operator,terra_reviewer;
create policy operator_read on terra_private.machine_publication_activations for select to terra_operator using(true);
create policy reviewer_read on terra_private.machine_publication_activations for select to terra_reviewer using(true);
create trigger machine_publication_activation_immutable before update or delete
 on terra_private.machine_publication_activations for each row
 execute function terra_private.block_automatic_decision_change();

create function terra_private.machine_publication_hash(p terra_private.issue_publications)
returns text language sql stable strict security invoker
set search_path=pg_catalog,pg_temp as $hash$
 select encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,
   'id',p.id,'issueId',p.issue_id,'revision',p.revision,'previousPublicationId',p.predecessor_id,
   'kind',p.publication_kind,'snapshot',p.snapshot,'dependencyManifest',p.dependency_manifest,
   'createdAt',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'UTF8')),'hex');
$hash$;

create function terra_private.check_machine_publication_activation()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare
 d terra_private.machine_candidate_decisions%rowtype;
 q terra_private.automatic_route_qualifications%rowtype;
 s terra_private.source_registrations%rowtype;
 v terra_private.source_versions%rowtype;
 r terra_private.update_runs%rowtype;
 p terra_private.issue_publications%rowtype;
 now_at timestamptz;
begin
 select * into d from terra_private.machine_candidate_decisions where id=new.decision_id;
 select * into q from terra_private.automatic_route_qualifications where id=d.qualification_id;
 select * into s from terra_private.source_registrations where id=q.registration_id for update;
 select * into v from terra_private.source_versions where id=d.source_version_id for update;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 perform terra_private.assert_update_run_work(new.run_id,new.request_fingerprint,new.work_claim_id);
 select * into p from terra_private.issue_publications where id=new.publication_id for update;
 now_at:=clock_timestamp();
 if d.id is null or q.id is null or s.id is null or v.id is null or r.id is null or p.id is null
    or d.run_id<>r.id or d.disposition<>'eligible'
    or r.mode<>'publish_eligible' or r.run_state<>'running'
    or r.request_fingerprint is distinct from new.request_fingerprint
    or r.policy_version is distinct from q.policy_version
    or r.commit_state<>'partial' or r.visibility_state<>'pending'
    or s.registration_state<>'approved' or not s.allow_fetch or not s.fetch_enabled
    or not s.allow_public_derived or s.reviewed_at is null or not isfinite(s.reviewed_at)
    or s.reviewed_at>now_at or s.exact_endpoint is distinct from q.exact_endpoint
    or q.decision<>'qualified' or q.revision<>(select max(revision)
       from terra_private.automatic_route_qualifications where registration_id=s.id and change_class=q.change_class)
    or q.qualification_expires_at is null or now_at>=q.qualification_expires_at
    or not isfinite(q.qualification_expires_at) or not isfinite(q.decided_at)
    or not isfinite(d.decided_at) or d.decided_at<q.decided_at or d.decided_at>new.activated_at
    or v.registration_id<>s.id or v.source_url is distinct from q.exact_endpoint
    or v.content_sha256 is distinct from d.content_sha256
    or v.id is distinct from (select id from terra_private.source_versions
       where registration_id=s.id and item_key=v.item_key order by retrieved_at desc,id desc limit 1)
    or new.publication_sha256 is distinct from terra_private.machine_publication_hash(p)
    or p.predecessor_id is distinct from new.expected_head
    or p.publication_kind not in('accepted','correction')
    or not isfinite(p.created_at) or p.created_at>new.activated_at or new.activated_at>now_at
    or not exists(select 1 from terra_private.issue_heads where issue_id=p.issue_id and current_publication_id=p.id)
    or not exists(select 1 from terra_private.issue_publication_machine_bindings
       where publication_id=p.id and decision_id=d.id) then
   raise exception 'Activation authority or receipt is not current' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger machine_publication_activation_insert_guard before insert
 on terra_private.machine_publication_activations for each row
 execute function terra_private.check_machine_publication_activation();
-- Check again at transaction end, including wall-clock expiry after lock waits.
create constraint trigger machine_publication_activation_commit_guard after insert
 on terra_private.machine_publication_activations deferrable initially deferred
 for each row execute function terra_private.check_machine_publication_activation();

create function terra_private.block_activated_publication_change()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
begin
 if exists(select 1 from terra_private.machine_publication_activations where publication_id=old.id) then
   raise exception 'Activated publication is immutable' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger activated_publication_immutable before update
 on terra_private.issue_publications for each row
 execute function terra_private.block_activated_publication_change();

create function terra_private.activate_machine_publication(
 p_publication uuid,p_decision uuid,p_expected_head uuid,p_fingerprint text,p_lease uuid,
 p_publication_sha256 text)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $activate$
declare
 d terra_private.machine_candidate_decisions%rowtype;
 q terra_private.automatic_route_qualifications%rowtype;
 s terra_private.source_registrations%rowtype;
 v terra_private.source_versions%rowtype;
 r terra_private.update_runs%rowtype;
 p terra_private.issue_publications%rowtype;
 h terra_private.issue_heads%rowtype;
 j terra_private.jurisdictions%rowtype;
 dossier terra_private.issue_dossiers%rowtype;
 c terra_private.claims%rowtype;
 sr terra_private.source_display_reviews%rowtype;
 ir terra_private.issue_text_reviews%rowtype;
 pr terra_private.claim_period_reviews%rowtype;
 ar terra_private.claim_assertion_reviews%rowtype;
 prior terra_private.machine_publication_activations%rowtype;
 candidate jsonb;
 claim jsonb;
 evidence jsonb;
 now_at timestamptz;
begin
 if p_publication is null or p_decision is null or p_fingerprint is null
    or p_fingerprint !~ '^[0-9a-f]{64}$' or p_lease is null
    or p_publication_sha256 is null or p_publication_sha256 !~ '^[0-9a-f]{64}$' then
   raise exception 'Activation request is invalid' using errcode='23514';
 end if;
 -- Replaying a committed immutable receipt does not restart work or assert
 -- that its old publication is still the head or publicly visible.
 select * into prior from terra_private.machine_publication_activations where publication_id=p_publication or decision_id=p_decision;
 if prior.publication_id is not null then
   select * into p from terra_private.issue_publications where id=p_publication;
   if prior.publication_id<>p_publication or prior.decision_id<>p_decision or prior.expected_head is distinct from p_expected_head
      or prior.request_fingerprint is distinct from p_fingerprint
      or prior.publication_sha256 is distinct from p_publication_sha256
      or prior.publication_sha256 is distinct from terra_private.machine_publication_hash(p) then
     raise exception 'Activation replay conflicts with receipt' using errcode='23514';
   end if;
   return jsonb_build_object('schemaVersion',1,'status','already_activated',
      'publicationId',prior.publication_id,'decisionId',prior.decision_id,'runId',prior.run_id,
      'requestFingerprint',prior.request_fingerprint,'publicationSha256',prior.publication_sha256,'activatedAt',prior.activated_at,
      'visibilityState','pending','currentHeadMatches',exists(select 1 from terra_private.issue_heads
        where issue_id=p.issue_id and current_publication_id=p.id),'candidate',null);
 end if;
 select * into d from terra_private.machine_candidate_decisions where id=p_decision;
 select * into q from terra_private.automatic_route_qualifications where id=d.qualification_id;
 select * into s from terra_private.source_registrations where id=q.registration_id for update;
 select * into v from terra_private.source_versions where id=d.source_version_id for update;
 select * into r from terra_private.update_runs where id=d.run_id for update;
 -- A second identical call may have waited while the first committed.
 select * into p from terra_private.issue_publications where id=p_publication;
 select * into prior from terra_private.machine_publication_activations where publication_id=p_publication or decision_id=p_decision;
 if prior.publication_id is not null then
   if prior.publication_id<>p_publication or prior.decision_id<>p_decision or prior.expected_head is distinct from p_expected_head
      or prior.request_fingerprint is distinct from p_fingerprint
      or prior.publication_sha256 is distinct from p_publication_sha256
      or prior.publication_sha256 is distinct from terra_private.machine_publication_hash(p) then
     raise exception 'Activation replay conflicts with receipt' using errcode='23514';
   end if;
   return jsonb_build_object('schemaVersion',1,'status','already_activated',
      'publicationId',prior.publication_id,'decisionId',prior.decision_id,'runId',prior.run_id,
      'requestFingerprint',prior.request_fingerprint,'publicationSha256',prior.publication_sha256,'activatedAt',prior.activated_at,
      'visibilityState','pending','currentHeadMatches',exists(select 1 from terra_private.issue_heads where issue_id=p.issue_id and current_publication_id=p.id),'candidate',null);
 end if;
 perform terra_private.assert_update_run_work(r.id,p_fingerprint,p_lease);
 select * into p from terra_private.issue_publications where id=p_publication;
 select * into j from terra_private.jurisdictions where id=r.jurisdiction_id for update;
 select * into dossier from terra_private.issue_dossiers where id=p.issue_id for update;
 select * into h from terra_private.issue_heads where issue_id=dossier.id for update;
 select * into p from terra_private.issue_publications where id=p_publication for update;
 if d.id is null or q.id is null or s.id is null or v.id is null or r.id is null
    or p.id is null or j.id is null or dossier.id is null or h.issue_id is null
    or terra_private.machine_publication_hash(p) is distinct from p_publication_sha256
    or d.disposition<>'eligible' or r.mode<>'publish_eligible'
    or r.commit_state not in('none','partial') or r.visibility_state not in('not_required','pending')
    or j.coverage_state<>'published' or dossier.editorial_state<>'accepted'
    or dossier.jurisdiction_id<>r.jurisdiction_id or p.issue_id<>dossier.id
    or p.snapshot->>'jurisdictionSlug' is distinct from j.public_slug
    or p.snapshot->>'issueSlug' is distinct from dossier.public_slug
    or p.publication_kind not in('accepted','correction')
    or p.predecessor_id is distinct from p_expected_head
    or h.current_publication_id is distinct from p_expected_head
    or not terra_private.is_closed_public_issue_payload(p.snapshot,p.dependency_manifest) then
   raise exception 'Activation scope, run or predecessor is invalid' using errcode='23514';
 end if;
 if jsonb_array_length(p.snapshot->'claims')<>1 then
   raise exception 'Activation requires one selected condition' using errcode='23514';
 end if;
 claim:=p.snapshot #> '{claims,0}';
 if jsonb_array_length(claim->'evidence')<>1 then
   raise exception 'Activation requires one selected condition' using errcode='23514';
 end if;
 evidence:=claim #> '{evidence,0}';
 select * into c from terra_private.claims where id=(claim->>'id')::uuid for update;
 if c.id is null or c.issue_id<>p.issue_id or c.claim_type<>'condition' or c.evidence_state<>'supported'
    or claim->>'type'<>'condition' or claim->>'assertion' is distinct from c.assertion
    or evidence->>'sourceVersionId' is distinct from v.id::text
    or evidence->>'locator' is distinct from d.evidence_locator
    or evidence->>'url' is distinct from d.public_citation_url
    or evidence->>'publisher' is distinct from s.publisher or evidence->>'relation'<>'supports'
    or (evidence->>'retrievedAt')::timestamptz is distinct from v.retrieved_at
    or p.dependency_manifest is distinct from jsonb_build_object('sourceVersionIds',jsonb_build_array(v.id))
    or (select count(*) from terra_private.issue_publication_citations where publication_id=p.id)<>1 then
   raise exception 'Activation evidence is not selected' using errcode='23514';
 end if;
 select * into sr from terra_private.source_display_reviews where source_version_id=v.id order by revision desc limit 1;
 select * into ir from terra_private.issue_text_reviews where publication_id=p.id order by revision desc limit 1;
 select * into pr from terra_private.claim_period_reviews where publication_id=p.id and claim_id=c.id order by revision desc limit 1;
 select * into ar from terra_private.claim_assertion_reviews where publication_id=p.id and claim_id=c.id order by revision desc limit 1;
 now_at:=clock_timestamp();
 if sr.source_version_id is null or ir.publication_id is null or pr.publication_id is null or ar.publication_id is null
    or sr.decision<>'accepted' or ir.decision<>'accepted' or pr.decision<>'accepted' or ar.decision<>'accepted'
    or sr.display_title is distinct from evidence->>'title' or sr.title_language<>'en'
    or ir.display_title is distinct from p.snapshot->>'title' or ir.display_summary is distinct from p.snapshot->>'summary'
    or pr.period_label is distinct from claim->>'periodLabel' or ar.claim_type is distinct from c.claim_type
    or ar.display_assertion is distinct from c.assertion
    or not isfinite(sr.reviewed_at) or not isfinite(ir.reviewed_at)
    or not isfinite(pr.reviewed_at) or not isfinite(ar.reviewed_at)
    or greatest(sr.reviewed_at,ir.reviewed_at,pr.reviewed_at,ar.reviewed_at)>now_at then
   raise exception 'Activation display decisions are not current' using errcode='23514';
 end if;
 insert into terra_private.issue_publication_machine_bindings(publication_id,claim_id,decision_id)
   values(p.id,c.id,d.id);
 update terra_private.issue_heads set current_publication_id=p.id,changed_at=transaction_timestamp()
   where issue_id=p.issue_id;
 update terra_private.update_runs set commit_state='partial',visibility_state='pending' where id=r.id;
 insert into terra_private.machine_publication_activations(publication_id,decision_id,run_id,
   work_claim_id,expected_head,request_fingerprint,publication_sha256)
   values(p.id,d.id,r.id,p_lease,p_expected_head,p_fingerprint,terra_private.machine_publication_hash(p))
   returning * into prior;
 candidate:=terra_private.read_issue_candidate(j.public_slug,dossier.public_slug);
 if candidate is null or candidate ? 'candidate_state'
    or candidate #>> '{publication,id}' is distinct from p.id::text then
   raise exception 'Activated candidate is not readable' using errcode='23514';
 end if;
 return jsonb_build_object('schemaVersion',1,'status','activated',
    'publicationId',p.id,'decisionId',d.id,'runId',r.id,'requestFingerprint',prior.request_fingerprint,
    'publicationSha256',prior.publication_sha256,
    'activatedAt',prior.activated_at,'visibilityState','pending','currentHeadMatches',true,'candidate',candidate);
exception when invalid_text_representation or datetime_field_overflow then
 raise exception 'Activation request is invalid' using errcode='23514';
end;
$activate$;

revoke all on function terra_private.machine_publication_hash(terra_private.issue_publications),
 terra_private.check_machine_publication_activation(),terra_private.block_activated_publication_change(),
 terra_private.activate_machine_publication(uuid,uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

commit;
