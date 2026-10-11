-- Invented standalone shared admission experiment after the three frozen schemas.
-- NEVER primary migration, real authentication/transport, active restart or host
-- limiter installation. Same accepted policy; network-none/portless cluster only.
create role tf_shared_writer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role tf_shared_recovery nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create schema tf_shared_admission_trial authorization tf_bound_owner;
revoke all on schema tf_shared_admission_trial from public;
-- Only the composed facades are ordinary intake/recovery entries in this trial.
revoke execute on function tf_contact_free_write_trial.submit_invented(uuid,uuid,jsonb,bigint) from tf_trial_writer;
revoke execute on function tf_contact_free_write_trial.recover_invented(uuid,uuid,uuid,jsonb,bigint) from tf_write_recovery;

set role tf_bound_owner;
create table tf_shared_admission_trial.context(singleton boolean primary key check(singleton),
 execution_id uuid not null,known boolean not null,last_now_ms bigint not null);
create table tf_shared_admission_trial.buckets(key uuid primary key,epoch bigint not null,
 expires_at_ms bigint not null,attempts bigint[] not null check(cardinality(attempts)<=5));
create table tf_shared_admission_trial.reservations(ticket uuid primary key,operation_id uuid unique,
 admitted_at_ms bigint,phase text not null check(phase in('reserved','armed','dispatched','expired')),
 request_id uuid,target jsonb,
 check((phase='expired')=(operation_id is null)),check((phase='expired')=(admitted_at_ms is null)),
 check((phase in('armed','dispatched'))=(request_id is not null)),
 check((request_id is null)=(target is null)));
-- Hourly observations contain timestamps only, not report/client identifiers.
create table tf_shared_admission_trial.accepted(observed_at_ms bigint not null);
alter table tf_shared_admission_trial.context enable row level security;
alter table tf_shared_admission_trial.buckets enable row level security;
alter table tf_shared_admission_trial.reservations enable row level security;
alter table tf_shared_admission_trial.accepted enable row level security;

create function tf_shared_admission_trial.lock_context(e uuid) returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare c tf_shared_admission_trial.context;at_ms bigint;source_ms bigint;
begin
 select * into c from tf_shared_admission_trial.context where singleton for update;
 if not found or not c.known or c.execution_id is distinct from e then return null;end if;
 perform from tf_contact_free_write_trial.context_state where singleton and known and execution_id=e for update;
 if not found then update tf_shared_admission_trial.context set known=false;return null;end if;
 at_ms:=tf_contact_free_trial.composed_lock_clock();
 select now_ms into source_ms from tf_bound_trial.clock_state where singleton and known for share;
 if at_ms is null or source_ms is null or at_ms<>source_ms or at_ms<c.last_now_ms
  or at_ms not between 0 and 9007199254740991-15552000000 then
  update tf_shared_admission_trial.context set known=false;return null;end if;
 update tf_shared_admission_trial.context set last_now_ms=at_ms;
 delete from tf_shared_admission_trial.buckets where expires_at_ms<=at_ms;
 update tf_shared_admission_trial.buckets b set attempts=array(select t from unnest(b.attempts) t where t>at_ms-900000);
 delete from tf_shared_admission_trial.accepted where observed_at_ms<=at_ms-3600000;
 -- Expiry strips owned operation/request/target/admission metadata, retaining
 -- only an opaque uncertain slot. It never proves an unknown write absent.
 update tf_shared_admission_trial.reservations set operation_id=null,admitted_at_ms=null,
  request_id=null,target=null,phase='expired' where admitted_at_ms+15552000000<=at_ms;
 return at_ms;
end $$;

create function tf_shared_admission_trial.begin_invented(e uuid,o uuid,k uuid,p uuid,input_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;current_epoch bigint;b tf_shared_admission_trial.buckets;
 previous_attempts integer;ticket_id uuid;
begin
 if not tf_bound_trial.valid_id(e::text) or not tf_bound_trial.valid_id(o::text)
  or not tf_bound_trial.valid_id(k::text) or not tf_bound_trial.valid_id(p::text) or k=p or input_epoch is null then return '{"kind":"held"}';end if;
 at_ms:=tf_shared_admission_trial.lock_context(e);if at_ms is null then return '{"kind":"held"}';end if;
 current_epoch:=at_ms/900000;
 if input_epoch<>current_epoch then return '{"kind":"held"}';end if;
 select * into b from tf_shared_admission_trial.buckets where key=k;
 if found and b.epoch<>input_epoch then return '{"kind":"held"}';end if;
 if exists(select from tf_shared_admission_trial.buckets where key=p and buckets.epoch<>input_epoch-1) then return '{"kind":"held"}';end if;
 select coalesce(cardinality(attempts),0) into previous_attempts from tf_shared_admission_trial.buckets where key=p;
 previous_attempts:=coalesce(previous_attempts,0);
 if coalesce(cardinality(b.attempts),0)+previous_attempts>=5 then return '{"kind":"held"}';end if;
 if b.key is null then
  if (select count(*) from tf_shared_admission_trial.buckets)>=400 then return '{"kind":"held"}';end if;
  insert into tf_shared_admission_trial.buckets values(k,input_epoch,(input_epoch+2)*900000,array[at_ms]);
 else update tf_shared_admission_trial.buckets set attempts=array_append(attempts,at_ms) where key=k;end if;
 -- Valid attempts consume the address window before busy/global/open/unknown
 -- checks. No body or current-public payload is supplied at admission.
 if exists(select from tf_shared_admission_trial.reservations where phase<>'reserved')
  or (select count(*) from tf_shared_admission_trial.reservations)>=2
  or (select count(*) from tf_shared_admission_trial.accepted)+(select count(*) from tf_shared_admission_trial.reservations)>=60
  or (select count(*) from tf_contact_free_trial.records where closed_at_ms is null)+(select count(*) from tf_shared_admission_trial.reservations)>=200
  or (select count(*) from tf_contact_free_write_trial.operations)>=400
  or exists(select from tf_contact_free_write_trial.operations where operation_id=o)
  or exists(select from tf_shared_admission_trial.reservations where operation_id=o) then return '{"kind":"held"}';end if;
 ticket_id:=gen_random_uuid();
 insert into tf_shared_admission_trial.reservations values(ticket_id,o,at_ms,'reserved',null,null);
 return jsonb_build_object('kind','reserved_invented','ticket',ticket_id,'operationId',o,'admittedAtMs',at_ms);
exception when others then return '{"kind":"held"}';
end $$;

create function tf_shared_admission_trial.release_prewrite_invented(e uuid,t uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tf_shared_admission_trial.lock_context(e) is null then return '{"kind":"held"}';end if;
 -- Caller must have retired actual physical body work first. SQL supplies no
 -- native stream/cancellation proof; only a never-armed reservation can release.
 delete from tf_shared_admission_trial.reservations where ticket=t and phase='reserved';
 return case when found then '{"kind":"released_invented"}'::jsonb else '{"kind":"held"}'::jsonb end;
end $$;

create function tf_shared_admission_trial.arm_invented(e uuid,t uuid,request uuid,target jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;r tf_shared_admission_trial.reservations;
begin
 if not tf_bound_trial.valid_id(request::text) or not tf_contact_free_write_trial.valid_target(target) then return '{"kind":"held"}';end if;
 at_ms:=tf_shared_admission_trial.lock_context(e);if at_ms is null then return '{"kind":"held"}';end if;
 select * into r from tf_shared_admission_trial.reservations where ticket=t and phase='reserved';
 if not found or at_ms>=r.admitted_at_ms+7776000000 then return '{"kind":"held"}';end if;
 update tf_shared_admission_trial.reservations set phase='armed',request_id=request,
  target=arm_invented.target where ticket=t;
 return jsonb_build_object('kind','armed_invented','operationId',r.operation_id,'admittedAtMs',r.admitted_at_ms);
end $$;

create function tf_shared_admission_trial.write_invented(e uuid,t uuid,packet jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;r tf_shared_admission_trial.reservations;result jsonb;
begin
 at_ms:=tf_shared_admission_trial.lock_context(e);if at_ms is null then return '{"kind":"held"}';end if;
 select * into r from tf_shared_admission_trial.reservations where ticket=t and phase='armed';
 if not found or not tf_contact_free_write_trial.valid_packet(packet)
  or packet->>'requestId'<>r.request_id::text or packet->'draft'->'target'<>r.target then return '{"kind":"held"}';end if;
 -- This lock spans the actual B transaction. A concurrent recovery waits; if
 -- it fences first, the reservation has gone and this port cannot call B.
 update tf_shared_admission_trial.reservations set phase='dispatched' where ticket=t;
 result:=tf_contact_free_write_trial.submit_invented(e,r.operation_id,packet,r.admitted_at_ms);
 -- Even a committed known effect remains reserved until explicit metadata-only
 -- settlement. Lost caller acknowledgement cannot release or retry this slot.
 return result;
exception when others then return '{"kind":"held"}';
end $$;

create function tf_shared_admission_trial.resolve_invented(e uuid,t uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare at_ms bigint;r tf_shared_admission_trial.reservations;result jsonb;
begin
 at_ms:=tf_shared_admission_trial.lock_context(e);if at_ms is null then return '{"kind":"held"}';end if;
 select * into r from tf_shared_admission_trial.reservations where ticket=t and phase in('armed','dispatched');
 if not found then return '{"kind":"held"}';end if;
 result:=tf_contact_free_write_trial.recover_invented(e,r.operation_id,r.request_id,r.target,r.admitted_at_ms);
 if result->>'outcome'='known_nonwrite' then
  delete from tf_shared_admission_trial.reservations where ticket=t;
 elsif result->>'outcome'='confirmed' then
  if result->'result'->'replayed'='false'::jsonb then
   insert into tf_shared_admission_trial.accepted values(at_ms);
  end if;
  delete from tf_shared_admission_trial.reservations where ticket=t;
 end if;
 return result;
exception when others then return '{"kind":"held"}';
end $$;

create function tf_shared_admission_trial.counts_invented(e uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tf_shared_admission_trial.lock_context(e) is null then return '{"kind":"held"}';end if;
 return jsonb_build_object('kind','invented_counts',
  'acceptedInHour',(select count(*) from tf_shared_admission_trial.accepted),
  'openReports',(select count(*) from tf_contact_free_trial.records where closed_at_ms is null),
  'reserved',(select count(*) from tf_shared_admission_trial.reservations),
  'unknown',(select count(*) from tf_shared_admission_trial.reservations where phase<>'reserved'),
  'addressBuckets',(select count(*) from tf_shared_admission_trial.buckets));
end $$;
reset role;
revoke all on all functions in schema tf_shared_admission_trial from public;
grant usage on schema tf_shared_admission_trial to tf_shared_writer,tf_shared_recovery;
grant execute on function tf_shared_admission_trial.begin_invented(uuid,uuid,uuid,uuid,bigint),
 tf_shared_admission_trial.release_prewrite_invented(uuid,uuid),
 tf_shared_admission_trial.arm_invented(uuid,uuid,uuid,jsonb),
 tf_shared_admission_trial.write_invented(uuid,uuid,jsonb) to tf_shared_writer;
grant execute on function tf_shared_admission_trial.resolve_invented(uuid,uuid),
 tf_shared_admission_trial.counts_invented(uuid) to tf_shared_recovery;
-- No ordinary direct tables/owner switch/custody plaintext/writer bypass.
