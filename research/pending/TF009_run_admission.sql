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
