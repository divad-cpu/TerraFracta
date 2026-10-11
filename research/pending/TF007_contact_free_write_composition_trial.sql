-- Invented standalone integration only, after the two frozen trial schemas.
-- NEVER migration/installer, primary connection, source/publication qualification
-- or real-principal/host authentication. New network-none/portless cluster only.
create role tf_write_recovery nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create schema tf_contact_free_write_trial authorization tf_bound_owner;
revoke all on schema tf_contact_free_write_trial from public;

-- Direct staging would leave an unretained private copy. This fresh integration
-- removes that ordinary role grant; the only writer entry transfers custody in
-- the same transaction and deletes the temporary stage before commit.
revoke execute on function tf_bound_trial.write_invented(jsonb) from tf_bound_writer;
grant usage on schema tf_contact_free_trial to tf_bound_owner;
grant select,insert on tf_contact_free_trial.records,tf_contact_free_trial.payloads to tf_bound_owner;
grant execute on function tf_contact_free_trial.payload_expiry(tf_contact_free_trial.records) to tf_bound_owner;
-- INSERT payload constraints invoke this closed immutable custody validator.
grant execute on function tf_contact_free_trial.valid_text(text,integer,integer) to tf_bound_owner;
create policy composed_record_read on tf_contact_free_trial.records for select to tf_bound_owner using(true);
create policy composed_record_insert on tf_contact_free_trial.records for insert to tf_bound_owner with check(true);
create policy composed_payload_read on tf_contact_free_trial.payloads for select to tf_bound_owner using(true);
create policy composed_payload_insert on tf_contact_free_trial.payloads for insert to tf_bound_owner with check(true);

-- Owner-scoped locking helpers avoid UPDATE grants merely to acquire row locks.
set role tf_trial_owner;
create function tf_contact_free_trial.composed_lock_clock() returns bigint
language sql security definer set search_path=pg_catalog as $$
 select now_ms from tf_contact_free_trial.clock_state where singleton and known for share
$$;
create function tf_contact_free_trial.composed_lock_record(request uuid) returns tf_contact_free_trial.records
language sql security definer set search_path=pg_catalog as $$
 select r.* from tf_contact_free_trial.records r where request_id=request for update
$$;
reset role;
revoke all on function tf_contact_free_trial.composed_lock_clock(),tf_contact_free_trial.composed_lock_record(uuid) from public;
grant execute on function tf_contact_free_trial.composed_lock_clock(),tf_contact_free_trial.composed_lock_record(uuid) to tf_bound_owner;

set role tf_bound_owner;
create table tf_contact_free_write_trial.context_state(singleton boolean primary key check(singleton),
  execution_id uuid not null,known boolean not null);
create table tf_contact_free_write_trial.operations(
  operation_id uuid primary key,execution_id uuid not null,request_id uuid not null,target jsonb not null,
  admitted_at_ms bigint not null,expires_at_ms bigint not null,
  state text not null check(state in('recorded','nonwrite')),report_id uuid,inserted boolean,
  check((state='recorded')=(report_id is not null)),check((state='recorded')=(inserted is not null)),
  check(admitted_at_ms between 0 and 9007199254740991-15552000000),
  check(expires_at_ms>admitted_at_ms and expires_at_ms<=admitted_at_ms+15552000000));
alter table tf_contact_free_write_trial.context_state enable row level security;
alter table tf_contact_free_write_trial.operations enable row level security;

create function tf_contact_free_write_trial.valid_target(t jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
begin
 return coalesce(jsonb_typeof(t)='object'
  and (select array_agg(k order by k) from jsonb_object_keys(t) k)=array['claimId','issueId','issueSlug','jurisdictionSlug','publicationId','revision']
  and tf_bound_trial.valid_id(t->>'issueId') and tf_bound_trial.valid_id(t->>'publicationId')
  and jsonb_typeof(t->'revision')='number' and (t->>'revision')::numeric between 1 and 9007199254740991
  and trunc((t->>'revision')::numeric)=(t->>'revision')::numeric
  and jsonb_typeof(t->'jurisdictionSlug')='string' and length(t->>'jurisdictionSlug') between 1 and 80
  and t->>'jurisdictionSlug' ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and jsonb_typeof(t->'issueSlug')='string' and length(t->>'issueSlug') between 1 and 100
  and t->>'issueSlug' ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and (t->'claimId'='null'::jsonb or jsonb_typeof(t->'claimId')='string' and tf_bound_trial.valid_id(t->>'claimId')),false);
exception when others then return false;
end $$;

create function tf_contact_free_write_trial.valid_packet(packet jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare fields jsonb;
begin
 if packet is null or octet_length(packet::text)>16384 or jsonb_typeof(packet)<>'object'
  or (select array_agg(k order by k) from jsonb_object_keys(packet) k) is distinct from array['draft','requestId','schemaVersion']
  or packet->'schemaVersion'<>'1'::jsonb or jsonb_typeof(packet->'requestId')<>'string'
  or not tf_bound_trial.valid_id(packet->>'requestId') or packet->>'requestId'<>lower(packet->>'requestId')
  or jsonb_typeof(packet->'draft')<>'object'
  or (select array_agg(k order by k) from jsonb_object_keys(packet->'draft') k) is distinct from array['fields','target']
  or not tf_contact_free_write_trial.valid_target(packet->'draft'->'target') then return false;end if;
 fields:=packet->'draft'->'fields';
 return coalesce(jsonb_typeof(fields)='object'
  and (select array_agg(k order by k) from jsonb_object_keys(fields) k)=array['details','kind','sourceUrl']
  and jsonb_typeof(fields->'kind')='string' and fields->>'kind' in('incorrect_statement','missing_context','broken_source_link','accessibility_problem')
  and jsonb_typeof(fields->'details')='string' and fields->>'details'=tf_bound_trial.trimmed(fields->>'details') and tf_bound_trial.valid_text(fields->>'details',10,1000)
  and jsonb_typeof(fields->'sourceUrl')='string' and fields->>'sourceUrl'=tf_bound_trial.trimmed(fields->>'sourceUrl') and tf_bound_trial.valid_text(fields->>'sourceUrl',0,2048)
  and fields->>'sourceUrl' !~ '[[:space:][:cntrl:]]'
  and (fields->>'sourceUrl'='' or fields->>'sourceUrl' ~ '^https://[^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$'),false);
exception when others then return false;
end $$;

create function tf_contact_free_write_trial.envelope(e uuid,o uuid,disposition text,body jsonb default null)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('executionId',e,'operationId',o,'outcome',disposition,'result',body)
$$;

create function tf_contact_free_write_trial.observation(op tf_contact_free_write_trial.operations,at_ms bigint)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare r tf_contact_free_trial.records;available boolean;
begin
 if op.state='nonwrite' then return tf_contact_free_write_trial.envelope(op.execution_id,op.operation_id,'known_nonwrite');end if;
 select * into r from tf_contact_free_trial.records where report_id=op.report_id;
 if not found or r.request_id<>op.request_id or r.target<>op.target or at_ms<r.received_at_ms
  or r.closed_at_ms>at_ms or r.erased_at_ms>at_ms or r.closed_at_ms>r.erased_at_ms
  or at_ms>=r.received_at_ms+15552000000 or at_ms>=op.expires_at_ms then
   return tf_contact_free_write_trial.envelope(op.execution_id,op.operation_id,'unknown');
 end if;
 available:=at_ms<tf_contact_free_trial.payload_expiry(r);
 if available and not exists(select from tf_contact_free_trial.payloads where report_id=r.report_id) then
  return tf_contact_free_write_trial.envelope(op.execution_id,op.operation_id,'unknown');
 end if;
 return tf_contact_free_write_trial.envelope(op.execution_id,op.operation_id,'confirmed',
  jsonb_build_object('schemaVersion',1,'status','recorded_private','requestId',r.request_id,
   'reportId',r.report_id,'publicationId',r.target->'publicationId','revision',r.target->'revision',
   'replayed',not op.inserted,'operationId',op.operation_id,'target',r.target,'version',r.version,
   'observedAtMs',at_ms,'payloadAvailable',available,
   'lifecycle',jsonb_build_object('schemaVersion',1,'reportId',r.report_id,'receivedAtMs',r.received_at_ms,
    'closedAtMs',r.closed_at_ms,'erasedAtMs',r.erased_at_ms,'eraseReason',r.erase_reason)));
end $$;

create function tf_contact_free_write_trial.submit_invented(e uuid,o uuid,packet jsonb,admitted bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;source_ms bigint;request uuid;submitted_target jsonb;fields jsonb;
 stage jsonb;s tf_bound_trial.records;p tf_bound_trial.payloads;r tf_contact_free_trial.records;
 prior_body tf_contact_free_trial.payloads;op tf_contact_free_write_trial.operations;is_new boolean;
begin
 if not tf_bound_trial.valid_id(e::text) or not tf_bound_trial.valid_id(o::text)
  or admitted is null or admitted not between 0 and 9007199254740991-15552000000
  or not tf_contact_free_write_trial.valid_packet(packet) then
  return tf_contact_free_write_trial.envelope(e,o,'unknown');
 end if;
 request:=(packet->>'requestId')::uuid;submitted_target:=packet->'draft'->'target';fields:=packet->'draft'->'fields';
 -- UUID-only advisory key; no report-text digest is created or retained. The
 -- lock survives the inner rollback and orders a late server write vs recovery.
 perform pg_advisory_xact_lock(hashtextextended(e::text||'/'||o::text,0));
 perform from tf_contact_free_write_trial.context_state where singleton and known and execution_id=e for update;
 if not found then return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
 at_ms:=tf_contact_free_trial.composed_lock_clock();
 select now_ms into source_ms from tf_bound_trial.clock_state where singleton and known for share;
 if at_ms is null or source_ms is null or at_ms<>source_ms or at_ms<admitted or at_ms>=admitted+15552000000 then
  return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
 select * into op from tf_contact_free_write_trial.operations where operation_id=o;
 if found then
  if op.execution_id<>e or op.request_id<>request or op.target<>submitted_target or op.admitted_at_ms<>admitted
   or at_ms>=op.expires_at_ms then return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
  if op.state='recorded' then
   select * into prior_body from tf_contact_free_trial.payloads where report_id=op.report_id;
   if not found or prior_body.kind<>fields->>'kind' or prior_body.details<>fields->>'details'
    or prior_body.source_url<>fields->>'sourceUrl' then return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
  end if;
  return tf_contact_free_write_trial.observation(op,at_ms);
 end if;
 if (select count(*) from tf_contact_free_write_trial.operations)>=400 then
  return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
 begin
  if at_ms>=admitted+7776000000 then raise exception 'Invented intent expired';end if;
  stage:=tf_bound_trial.write_invented(packet);
  if stage->>'kind'<>'recorded_invented' then raise exception 'Invented current write held';end if;
  select * into s from tf_bound_trial.records where report_id=(stage->>'reportId')::uuid;
  select * into p from tf_bound_trial.payloads where report_id=s.report_id;
  if s.report_id is null or p.report_id is null or s.request_id<>request or s.target<>submitted_target or s.received_at_ms<>at_ms then
   raise exception 'Invented staging context differs';end if;
  select * into r from tf_contact_free_trial.composed_lock_record(request);
  is_new:=r.report_id is null;
  if is_new then
   insert into tf_contact_free_trial.records(report_id,request_id,target,received_at_ms)
    values(s.report_id,request,submitted_target,s.received_at_ms);
   insert into tf_contact_free_trial.payloads values(s.report_id,p.kind,p.details,p.source_url,null);
   select * into r from tf_contact_free_trial.records where report_id=s.report_id;
  else
   select * into prior_body from tf_contact_free_trial.payloads where report_id=r.report_id;
   if not found or r.target<>submitted_target or at_ms<r.received_at_ms or at_ms>=tf_contact_free_trial.payload_expiry(r)
    or prior_body.kind<>p.kind or prior_body.details<>p.details or prior_body.source_url<>p.source_url then
    raise exception 'Invented retry differs';end if;
  end if;
  delete from tf_bound_trial.records where report_id=s.report_id;
  insert into tf_contact_free_write_trial.operations values(o,e,request,submitted_target,admitted,
   least(admitted+15552000000,r.received_at_ms+15552000000),'recorded',r.report_id,is_new) returning * into op;
 exception when others then
  -- Roll back staged/custody writes together. Persist only a bounded minimal
  -- nonwrite fence in the outer transaction; no body, URL, digest or address.
  insert into tf_contact_free_write_trial.operations values(o,e,request,submitted_target,admitted,
   admitted+15552000000,'nonwrite',null,null) returning * into op;
 end;
 return tf_contact_free_write_trial.observation(op,at_ms);
exception when others then return tf_contact_free_write_trial.envelope(e,o,'unknown');
end $$;

create function tf_contact_free_write_trial.recover_invented(e uuid,o uuid,request uuid,t jsonb,admitted bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;source_ms bigint;op tf_contact_free_write_trial.operations;
begin
 if not tf_bound_trial.valid_id(e::text) or not tf_bound_trial.valid_id(o::text) or not tf_bound_trial.valid_id(request::text)
  or not tf_contact_free_write_trial.valid_target(t) or admitted is null
  or admitted not between 0 and 9007199254740991-15552000000 then return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
 perform pg_advisory_xact_lock(hashtextextended(e::text||'/'||o::text,0));
 perform from tf_contact_free_write_trial.context_state where singleton and known and execution_id=e for update;
 if not found then return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
 at_ms:=tf_contact_free_trial.composed_lock_clock();
 select now_ms into source_ms from tf_bound_trial.clock_state where singleton and known for share;
 if at_ms is null or source_ms is null or at_ms<>source_ms or at_ms<admitted or at_ms>=admitted+15552000000 then
  return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
 select * into op from tf_contact_free_write_trial.operations where operation_id=o;
 if not found then
  if (select count(*) from tf_contact_free_write_trial.operations)>=400 then return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
  -- Absence alone cannot forbid a later server write. Fence this owned attempt
  -- under the same advisory/context lock. Recovery never inserts a report/body.
  insert into tf_contact_free_write_trial.operations values(o,e,request,t,admitted,admitted+15552000000,'nonwrite',null,null) returning * into op;
 end if;
 if op.execution_id<>e or op.request_id<>request or op.target<>t or op.admitted_at_ms<>admitted
  or at_ms>=op.expires_at_ms then return tf_contact_free_write_trial.envelope(e,o,'unknown');end if;
 return tf_contact_free_write_trial.observation(op,at_ms);
exception when others then return tf_contact_free_write_trial.envelope(e,o,'unknown');
end $$;

create function tf_contact_free_write_trial.expire_operations() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;source_ms bigint;removed integer;
begin
 perform from tf_contact_free_write_trial.context_state where singleton and known for update;
 if not found then return '{"kind":"held"}';end if;
 at_ms:=tf_contact_free_trial.composed_lock_clock();
 select now_ms into source_ms from tf_bound_trial.clock_state where singleton and known for share;
 if at_ms is null or source_ms is null or at_ms<>source_ms then return '{"kind":"held"}';end if;
 delete from tf_contact_free_write_trial.operations where expires_at_ms<=at_ms;
 get diagnostics removed=row_count;
 return jsonb_build_object('kind','expired_operations','removed',removed);
end $$;
reset role;
revoke all on all functions in schema tf_contact_free_write_trial from public;
grant usage on schema tf_contact_free_write_trial to tf_trial_writer,tf_write_recovery,tf_trial_custodian;
grant execute on function tf_contact_free_write_trial.submit_invented(uuid,uuid,jsonb,bigint) to tf_trial_writer;
grant execute on function tf_contact_free_write_trial.recover_invented(uuid,uuid,uuid,jsonb,bigint) to tf_write_recovery;
grant execute on function tf_contact_free_write_trial.expire_operations() to tf_trial_custodian;
-- No ordinary table/current-public/read/close/erase/owner-jump grants. Custody
-- retains its original reviewer/custodian functions and separate private roles.
