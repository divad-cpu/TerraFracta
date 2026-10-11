-- Owner-only candidate on migration 29. No primary migration or runtime grant.
-- Immutable reservations/dispatches/settlements; uncertain attempts keep capacity.
-- A trusted driver commits dispatch before opening its fixed source transport.

create table terra_private.source_response_reservations (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references terra_private.update_runs(id),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 registration_id uuid not null references terra_private.source_registrations(id),
 request_key text not null check(request_key~'^[a-z0-9][a-z0-9:_-]{0,159}$'),
 max_body_bytes integer not null check(max_body_bytes between 1 and 49999999),
 endpoint_sha256 text not null check(endpoint_sha256~'^[0-9a-f]{64}$'),
 reserved_at timestamptz not null default clock_timestamp() check(isfinite(reserved_at)),
 unique(run_id,request_key)
);
create index response_reservations_registration_idx
 on terra_private.source_response_reservations(registration_id,run_id);
create index response_reservations_claim_idx on terra_private.source_response_reservations(work_claim_id);

create table terra_private.source_response_dispatches (
 reservation_id uuid primary key references terra_private.source_response_reservations(id),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 dispatched_at timestamptz not null default clock_timestamp() check(isfinite(dispatched_at))
);
create index response_dispatches_claim_idx on terra_private.source_response_dispatches(work_claim_id);

create table terra_private.source_response_settlements (
 reservation_id uuid primary key references terra_private.source_response_dispatches(reservation_id),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 outcome text not null check(outcome in('measured','uncertain')),
 body_bytes integer not null check(body_bytes between 0 and 50000000),
 content_sha256 text check(content_sha256~'^[0-9a-f]{64}$'),
 settled_at timestamptz not null default clock_timestamp() check(isfinite(settled_at)),
 check((outcome='measured' and content_sha256 is not null) or
       (outcome='uncertain' and content_sha256 is null))
);
create index response_settlements_claim_idx on terra_private.source_response_settlements(work_claim_id);

alter table terra_private.source_response_reservations enable row level security;
alter table terra_private.source_response_dispatches enable row level security;
alter table terra_private.source_response_settlements enable row level security;
revoke all on terra_private.source_response_reservations,terra_private.source_response_dispatches,
 terra_private.source_response_settlements from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
grant select on terra_private.source_response_reservations,terra_private.source_response_dispatches,
 terra_private.source_response_settlements to terra_operator,terra_reviewer;
create policy operator_read on terra_private.source_response_reservations for select to terra_operator using(true);
create policy reviewer_read on terra_private.source_response_reservations for select to terra_reviewer using(true);
create policy operator_read on terra_private.source_response_dispatches for select to terra_operator using(true);
create policy reviewer_read on terra_private.source_response_dispatches for select to terra_reviewer using(true);
create policy operator_read on terra_private.source_response_settlements for select to terra_operator using(true);
create policy reviewer_read on terra_private.source_response_settlements for select to terra_reviewer using(true);
create trigger response_reservation_immutable before update or delete on terra_private.source_response_reservations
 for each row execute function terra_private.block_automatic_decision_change();
create trigger response_dispatch_immutable before update or delete on terra_private.source_response_dispatches
 for each row execute function terra_private.block_automatic_decision_change();
create trigger response_settlement_immutable before update or delete on terra_private.source_response_settlements
 for each row execute function terra_private.block_automatic_decision_change();

create function terra_private.response_reserved_charge(p_run uuid)
returns bigint language sql stable security invoker
set search_path=pg_catalog,pg_temp as $charge$
 select coalesce(sum(case when s.outcome='measured' then s.body_bytes
                    else r.max_body_bytes+1 end),0)::bigint
 from terra_private.source_response_reservations r
 left join terra_private.source_response_settlements s on s.reservation_id=r.id
 where r.run_id=p_run;
$charge$;

create function terra_private.assert_response_capture(p_run uuid,p_fingerprint text,p_claim uuid,
 p_registration uuid,p_endpoint_sha256 text)
returns void language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $assert$
declare s terra_private.source_registrations%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Response writes require read committed isolation' using errcode='23514';
 end if;
 perform terra_private.assert_update_run_work(p_run,p_fingerprint,p_claim);
 select * into s from terra_private.source_registrations where id=p_registration for share;
 if s.id is null or s.registration_state<>'approved' or not s.allow_fetch or not s.fetch_enabled
  or s.reviewed_at is null or not isfinite(s.reviewed_at) or s.reviewed_at>clock_timestamp()
  or encode(sha256(convert_to(s.exact_endpoint,'UTF8')),'hex') is distinct from p_endpoint_sha256
  or exists(select 1 from terra_private.update_run_source_checks where run_id=p_run and registration_id=p_registration)
  or exists(select 1 from terra_private.update_run_manifests where run_id=p_run)
  or exists(select 1 from terra_private.update_run_closeouts where run_id=p_run) then
  raise exception 'Response capture has no current source authority or open capture' using errcode='23514';
 end if;
end;
$assert$;

create function terra_private.check_response_reservation()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; c terra_private.update_run_work_claims%rowtype;
 count_source integer; count_run integer;
begin
 select * into r from terra_private.update_runs where id=new.run_id for update;
 perform terra_private.assert_response_capture(r.id,r.request_fingerprint,new.work_claim_id,
  new.registration_id,new.endpoint_sha256);
 select * into c from terra_private.update_run_work_claims where id=new.work_claim_id;
 if new.reserved_at<c.claimed_at or new.reserved_at>clock_timestamp() then
  raise exception 'Response reservation timestamp is invalid' using errcode='23514';
 end if;
 if tg_when='BEFORE' then
  select count(*) into count_source from terra_private.source_response_reservations
   where run_id=r.id and registration_id=new.registration_id;
  select count(*) into count_run from terra_private.source_response_reservations where run_id=r.id;
  if count_source>=(r.limits->>'max_retries')::integer+1
   or count_run>=(r.limits->>'max_items')::integer*((r.limits->>'max_retries')::integer+1)
   or terra_private.response_reserved_charge(r.id)+new.max_body_bytes+1>(r.limits->>'max_response_bytes')::integer then
   raise exception 'Response reservation exceeds admitted bytes or attempts' using errcode='23514';
  end if;
 elsif terra_private.response_reserved_charge(r.id)>(r.limits->>'max_response_bytes')::integer then
  raise exception 'Response reserved charge exceeds admitted cap' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger response_reservation_insert_guard before insert on terra_private.source_response_reservations
 for each row execute function terra_private.check_response_reservation();
create constraint trigger response_reservation_commit_guard after insert on terra_private.source_response_reservations
 deferrable initially deferred for each row execute function terra_private.check_response_reservation();

create function terra_private.check_response_dispatch()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 select request_fingerprint into fingerprint from terra_private.update_runs where id=q.run_id;
 perform terra_private.assert_response_capture(q.run_id,fingerprint,new.work_claim_id,q.registration_id,q.endpoint_sha256);
 if q.id is null or new.work_claim_id is distinct from q.work_claim_id
  or new.dispatched_at<q.reserved_at or new.dispatched_at>clock_timestamp()
  or exists(select 1 from terra_private.source_response_reservations where id=q.id and xmin=pg_current_xact_id()::xid)
  or (tg_when='BEFORE' and exists(select 1 from terra_private.source_response_settlements where reservation_id=q.id)) then
  raise exception 'Response dispatch is invalid or already settled' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger response_dispatch_insert_guard before insert on terra_private.source_response_dispatches
 for each row execute function terra_private.check_response_dispatch();
create constraint trigger response_dispatch_commit_guard after insert on terra_private.source_response_dispatches
 deferrable initially deferred for each row execute function terra_private.check_response_dispatch();

create function terra_private.check_response_settlement()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype;
 d terra_private.source_response_dispatches%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 select * into d from terra_private.source_response_dispatches where reservation_id=q.id;
 select request_fingerprint into fingerprint from terra_private.update_runs where id=q.run_id;
 perform terra_private.assert_response_capture(q.run_id,fingerprint,new.work_claim_id,q.registration_id,q.endpoint_sha256);
 if q.id is null or d.reservation_id is null or new.work_claim_id is distinct from d.work_claim_id
  or new.settled_at<d.dispatched_at or new.settled_at>clock_timestamp()
  or exists(select 1 from terra_private.source_response_dispatches where reservation_id=q.id and xmin=pg_current_xact_id()::xid)
  or new.body_bytes>q.max_body_bytes+1
  or (new.outcome='uncertain' and new.body_bytes<>q.max_body_bytes+1) then
  raise exception 'Response settlement does not match bounded dispatch' using errcode='23514';
 end if;
 return new;
end;
$guard$;
create trigger response_settlement_insert_guard before insert on terra_private.source_response_settlements
 for each row execute function terra_private.check_response_settlement();
create constraint trigger response_settlement_commit_guard after insert on terra_private.source_response_settlements
 deferrable initially deferred for each row execute function terra_private.check_response_settlement();

create function terra_private.response_reservation_receipt(p_id uuid,p_status text)
returns jsonb language sql stable security invoker
set search_path=pg_catalog,pg_temp as $receipt$
 select jsonb_build_object('schemaVersion',1,'status',p_status,'reservationId',q.id,
  'runId',q.run_id,'requestFingerprint',r.request_fingerprint,'workClaimId',q.work_claim_id,
  'registrationId',q.registration_id,'requestKey',q.request_key,'maxBodyBytes',q.max_body_bytes,
  'reservedBytes',q.max_body_bytes+1,'endpointSha256',q.endpoint_sha256,'reservedAt',q.reserved_at)
 from terra_private.source_response_reservations q join terra_private.update_runs r on r.id=q.run_id where q.id=p_id;
$receipt$;

create function terra_private.reserve_source_response(p_run uuid,p_fingerprint text,p_claim uuid,
 p_registration uuid,p_key text,p_max_body integer)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $reserve$
declare q terra_private.source_response_reservations%rowtype; endpoint_hash text;
begin
 select encode(sha256(convert_to(exact_endpoint,'UTF8')),'hex') into endpoint_hash
  from terra_private.source_registrations where id=p_registration;
 perform terra_private.assert_response_capture(p_run,p_fingerprint,p_claim,p_registration,endpoint_hash);
 if p_key is null or p_key !~ '^[a-z0-9][a-z0-9:_-]{0,159}$'
  or p_max_body is null or p_max_body not between 1 and 49999999 then
  raise exception 'Response request is invalid' using errcode='23514';
 end if;
 select * into q from terra_private.source_response_reservations where run_id=p_run and request_key=p_key;
 if q.id is not null then
  if row(q.registration_id,q.max_body_bytes,q.endpoint_sha256) is distinct from
     row(p_registration,p_max_body,endpoint_hash) then
   raise exception 'Response request key conflicts with reservation' using errcode='23514';
  end if;
  return terra_private.response_reservation_receipt(q.id,'existing');
 end if;
 insert into terra_private.source_response_reservations(run_id,work_claim_id,registration_id,
  request_key,max_body_bytes,endpoint_sha256) values(p_run,p_claim,p_registration,p_key,p_max_body,endpoint_hash)
  returning * into q;
 return terra_private.response_reservation_receipt(q.id,'reserved');
end;
$reserve$;

create function terra_private.dispatch_source_response(p_run uuid,p_fingerprint text,p_claim uuid,p_reservation uuid)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $dispatch$
declare q terra_private.source_response_reservations%rowtype; d terra_private.source_response_dispatches%rowtype;
 status text:='dispatched';
begin
 select * into q from terra_private.source_response_reservations where id=p_reservation;
 if q.id is null or q.run_id is distinct from p_run or q.work_claim_id is distinct from p_claim then
  raise exception 'Response reservation identity does not match' using errcode='23514';
 end if;
 perform terra_private.assert_response_capture(p_run,p_fingerprint,p_claim,q.registration_id,q.endpoint_sha256);
 select * into d from terra_private.source_response_dispatches where reservation_id=q.id;
 if d.reservation_id is not null then status:='existing';
 else
  insert into terra_private.source_response_dispatches(reservation_id,work_claim_id) values(q.id,p_claim) returning * into d;
 end if;
 return jsonb_build_object('schemaVersion',1,'status',status,'reservationId',q.id,'runId',q.run_id,
  'requestFingerprint',p_fingerprint,'workClaimId',p_claim,'dispatchedAt',d.dispatched_at);
end;
$dispatch$;

create function terra_private.settle_source_response(p_run uuid,p_fingerprint text,p_claim uuid,
 p_reservation uuid,p_outcome text,p_body_bytes integer,p_content_sha256 text)
returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $settle$
declare q terra_private.source_response_reservations%rowtype; s terra_private.source_response_settlements%rowtype;
 status text:='settled';
begin
 select * into q from terra_private.source_response_reservations where id=p_reservation;
 if q.id is null or q.run_id is distinct from p_run or q.work_claim_id is distinct from p_claim then
  raise exception 'Response reservation identity does not match' using errcode='23514';
 end if;
 perform terra_private.assert_response_capture(p_run,p_fingerprint,p_claim,q.registration_id,q.endpoint_sha256);
 select * into s from terra_private.source_response_settlements where reservation_id=q.id;
 if s.reservation_id is not null then
  if row(s.outcome,s.body_bytes,s.content_sha256) is distinct from row(p_outcome,p_body_bytes,p_content_sha256) then
   raise exception 'Response settlement retry conflicts with original receipt' using errcode='23514';
  end if;
  status:='existing';
 else
  insert into terra_private.source_response_settlements(reservation_id,work_claim_id,outcome,body_bytes,content_sha256)
   values(q.id,p_claim,p_outcome,p_body_bytes,p_content_sha256) returning * into s;
 end if;
 return jsonb_build_object('schemaVersion',1,'status',status,'reservationId',q.id,'runId',q.run_id,
  'requestFingerprint',p_fingerprint,'workClaimId',p_claim,'outcome',s.outcome,
  'bodyBytes',s.body_bytes,'chargedBytes',case when s.outcome='measured' then s.body_bytes else q.max_body_bytes+1 end,
  'contentSha256',s.content_sha256,'settledAt',s.settled_at);
end;
$settle$;

-- Link opted-in response accounting to the independently stored source check.
-- Legacy runs with no reservation remain untouched. A runtime wrapper must
-- require this path before any real transport; this is still owner-only.
create function terra_private.check_response_source_check()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype;
 q terra_private.source_response_reservations%rowtype;
 s terra_private.source_response_settlements%rowtype;
 source terra_private.source_registrations%rowtype;
 charged bigint;
begin
 if not exists(select 1 from terra_private.source_response_reservations where run_id=new.run_id) then
  return new;
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Response writes require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 perform terra_private.assert_update_run_work(r.id,r.request_fingerprint,new.work_claim_id);
 select * into source from terra_private.source_registrations where id=new.registration_id for share;
 select coalesce(sum(case when settlement.outcome='measured' then settlement.body_bytes
                    else reservation.max_body_bytes+1 end),0) into charged
 from terra_private.source_response_reservations reservation
 left join terra_private.source_response_settlements settlement on settlement.reservation_id=reservation.id
 where reservation.run_id=new.run_id and reservation.registration_id=new.registration_id;
 if new.total_response_bytes is distinct from charged then
  raise exception 'Source check does not match durable response charge' using errcode='23514';
 end if;
 if new.total_response_bytes>0 or new.outcome in('captured','unchanged') then
  if source.registration_state<>'approved' or not source.allow_fetch or not source.fetch_enabled
   or source.reviewed_at is null or source.reviewed_at>new.checked_at then
   raise exception 'Source check has no current response authority' using errcode='23514';
  end if;
 end if;
 if new.outcome in('captured','unchanged') then
  select * into q from terra_private.source_response_reservations
   where run_id=new.run_id and registration_id=new.registration_id order by reserved_at desc,id desc limit 1;
  select * into s from terra_private.source_response_settlements where reservation_id=q.id;
  if q.id is null or s.reservation_id is null or s.outcome<>'measured' or s.body_bytes>q.max_body_bytes
   or s.content_sha256 is distinct from new.content_sha256 or s.settled_at>new.checked_at
   or q.endpoint_sha256 is distinct from encode(sha256(convert_to(source.exact_endpoint,'UTF8')),'hex') then
   raise exception 'Successful source check has no matching final measured response' using errcode='23514';
  end if;
 end if;
 return new;
end;
$guard$;
create constraint trigger response_source_check_commit_guard after insert on terra_private.update_run_source_checks
 deferrable initially deferred for each row execute function terra_private.check_response_source_check();

revoke all on function terra_private.response_reserved_charge(uuid),
 terra_private.assert_response_capture(uuid,text,uuid,uuid,text),terra_private.check_response_reservation(),
 terra_private.check_response_source_check(),
 terra_private.check_response_dispatch(),terra_private.check_response_settlement(),
 terra_private.response_reservation_receipt(uuid,text),terra_private.reserve_source_response(uuid,text,uuid,uuid,text,integer),
 terra_private.dispatch_source_response(uuid,text,uuid,uuid),
 terra_private.settle_source_response(uuid,text,uuid,uuid,text,integer,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
