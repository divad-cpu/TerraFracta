-- CLOSED FICTIONAL SHADOW EXPERIMENT ONLY. No primary/runtime authorization.
-- Fictional isolated identity experiment only. Not a primary/runtime proposal.
-- A real SCRAM login is mapped by SESSION_USER to one fictional run/source.
-- No client-supplied actor, run, role, registration, endpoint or policy input.
-- Execute under one owner transaction; PUBLIC revocation precedes any grant.

create schema terra_capture_test_api;
revoke all on schema terra_capture_test_api from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
create table terra_capture_test_api.principal_scopes (
 principal name primary key,
 run_id uuid not null references terra_private.update_runs(id),
 registration_id uuid not null references terra_private.source_registrations(id),
 actor_id text not null check(actor_id='runner:fictional'),
 scope text not null check(scope='fictional-country'),
 max_body_bytes integer not null check(max_body_bytes between 1 and 65536),
 expires_at timestamptz not null check(isfinite(expires_at)),
 enabled boolean not null default false,
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 source_version_id uuid not null,
 item_key text not null check(item_key='fictional-share:2025'),
 body_sha256 text not null check(body_sha256~'^[0-9a-f]{64}$'),
 body_bytes integer not null check(body_bytes between 1 and 65536)
);
alter table terra_capture_test_api.principal_scopes enable row level security;
revoke all on terra_capture_test_api.principal_scopes from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_capture_test_api.current_scope()
returns terra_capture_test_api.principal_scopes language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $scope$
declare p terra_capture_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; s terra_private.source_registrations%rowtype;
begin
 -- Trust/peer connections cannot be relabelled as authenticated SCRAM calls.
 if system_user is distinct from 'scram-sha-256:'||session_user::text then
  raise exception 'Authenticated fictional response identity required' using errcode='42501';
 end if;
 select * into p from terra_capture_test_api.principal_scopes where principal=session_user for share;
 if p.principal is null or not p.enabled or clock_timestamp()>=p.expires_at then
  raise exception 'Fictional response principal has no active scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into s from terra_private.source_registrations where id=p.registration_id;
 if r.requested_by is distinct from p.actor_id or r.jurisdiction_id is distinct from p.scope
  or r.mode<>'shadow' or s.source_key is distinct from 'fictional-response'
  or s.exact_endpoint is distinct from 'https://example.org/fictional-table/data?format=json' then
  raise exception 'Fictional response scope does not match trusted run/source' using errcode='42501';
 end if;
 if p.work_claim_id is distinct from (select claim_id from terra_private.update_run_work_state where run_id=p.run_id)
  or p.body_bytes>p.max_body_bytes then
  raise exception 'Fictional capture scope has a different work fence' using errcode='42501';
 end if;
 return p;
end;
$scope$;

create function terra_capture_test_api.reserve_response(p_key text,p_max_body integer)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $reserve$
declare p terra_capture_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
begin
 p:=terra_capture_test_api.current_scope();
 if p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then
  raise exception 'Fictional response bound exceeds principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 return terra_private.reserve_source_response(p.run_id,r.request_fingerprint,w.claim_id,p.registration_id,p_key,p_max_body);
end;
$reserve$;

create function terra_capture_test_api.dispatch_response(p_reservation uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $dispatch$
declare p terra_capture_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 q terra_private.source_response_reservations%rowtype;
begin
 p:=terra_capture_test_api.current_scope();
 select * into q from terra_private.source_response_reservations where id=p_reservation;
 if q.id is null or q.run_id is distinct from p.run_id or q.registration_id is distinct from p.registration_id then
  raise exception 'Fictional response reservation is outside principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 return terra_private.dispatch_source_response(p.run_id,r.request_fingerprint,w.claim_id,p_reservation);
end;
$dispatch$;

create function terra_capture_test_api.settle_response(p_reservation uuid,p_outcome text,p_body_bytes integer,p_hash text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $settle$
declare p terra_capture_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 q terra_private.source_response_reservations%rowtype;
begin
 p:=terra_capture_test_api.current_scope();
 select * into q from terra_private.source_response_reservations where id=p_reservation;
 if q.id is null or q.run_id is distinct from p.run_id or q.registration_id is distinct from p.registration_id then
  raise exception 'Fictional response reservation is outside principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 return terra_private.settle_source_response(p.run_id,r.request_fingerprint,w.claim_id,p_reservation,
                                            p_outcome,p_body_bytes,p_hash);
end;
$settle$;

revoke all on function terra_capture_test_api.current_scope(),
 terra_capture_test_api.reserve_response(text,integer),terra_capture_test_api.dispatch_response(uuid),
 terra_capture_test_api.settle_response(uuid,text,integer,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
-- Test-specific LOGIN creation, scope seeding and three exact grants are supplied
-- by a fixed acceptance harness, with ephemeral passwords never written/logged.

-- Additive isolated identity experiment only, not the owner-only primary draft.
-- Deferred triggers execute after the caller has left the definer wrapper.
-- Keep original invoker BEFORE checks. Replace only the three deferred bindings
-- with closed definer copies that validate authenticated scope again at COMMIT.
-- No table grant, general invoker grant, deadline bypass or source activation.

create function terra_capture_test_api.validate_commit_scope(p_run uuid,p_registration uuid,p_max_body integer)
returns void language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $scope$
declare p terra_capture_test_api.principal_scopes%rowtype;
begin
 -- Isolated owner fixtures retain their existing direct owner route.
 if session_user in ('postgres','supabase_admin') then return; end if;
 p:=terra_capture_test_api.current_scope();
 if p.run_id is distinct from p_run or p.registration_id is distinct from p_registration
  or p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then
  raise exception 'Fictional response commit is outside principal scope' using errcode='42501';
 end if;
end;
$scope$;

create function terra_capture_test_api.check_reservation_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; c terra_private.update_run_work_claims%rowtype;
 count_source integer; count_run integer;
begin
 perform terra_capture_test_api.validate_commit_scope(new.run_id,new.registration_id,new.max_body_bytes);
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
drop trigger response_reservation_commit_guard on terra_private.source_response_reservations;
create constraint trigger response_reservation_commit_guard after insert on terra_private.source_response_reservations
 deferrable initially deferred for each row execute function terra_capture_test_api.check_reservation_commit();

create function terra_capture_test_api.check_dispatch_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 perform terra_capture_test_api.validate_commit_scope(q.run_id,q.registration_id,q.max_body_bytes);
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
drop trigger response_dispatch_commit_guard on terra_private.source_response_dispatches;
create constraint trigger response_dispatch_commit_guard after insert on terra_private.source_response_dispatches
 deferrable initially deferred for each row execute function terra_capture_test_api.check_dispatch_commit();

create function terra_capture_test_api.check_settlement_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype;
 d terra_private.source_response_dispatches%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 perform terra_capture_test_api.validate_commit_scope(q.run_id,q.registration_id,q.max_body_bytes);
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
drop trigger response_settlement_commit_guard on terra_private.source_response_settlements;
create constraint trigger response_settlement_commit_guard after insert on terra_private.source_response_settlements
 deferrable initially deferred for each row execute function terra_capture_test_api.check_settlement_commit();

revoke all on function terra_capture_test_api.validate_commit_scope(uuid,uuid,integer),
 terra_capture_test_api.check_reservation_commit(),terra_capture_test_api.check_dispatch_commit(),
 terra_capture_test_api.check_settlement_commit()
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

-- Isolated experiment only: fresh authority read AFTER the fixed adapter has
-- committed its operation. This adds no DML grant or general SQL permission.
-- A confirmation binds a saved receipt; it is not a fresh dispatch permission.
create function terra_capture_test_api.confirm_response(p_phase text,p_receipt text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $confirm$
declare p terra_capture_test_api.principal_scopes%rowtype;
 q terra_private.source_response_reservations%rowtype;
 d terra_private.source_response_dispatches%rowtype;
 s terra_private.source_response_settlements%rowtype;
 r terra_private.update_runs%rowtype;w terra_private.update_run_work_state%rowtype;
 incoming jsonb; expected jsonb; observed timestamptz; expires timestamptz;
begin
 p:=terra_capture_test_api.current_scope();
 if p_phase is null or p_phase not in('reserve','dispatch','settle') or p_receipt is null
  or octet_length(p_receipt) not between 2 and 4096 then
  raise exception 'Fictional response confirmation input is invalid' using errcode='23514';
 end if;
 incoming:=p_receipt::jsonb;
 select * into q from terra_private.source_response_reservations where id=(incoming->>'reservationId')::uuid;
 if q.id is null or q.run_id is distinct from p.run_id or q.registration_id is distinct from p.registration_id
  or q.max_body_bytes>p.max_body_bytes then
  raise exception 'Fictional response confirmation is outside principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 perform terra_private.assert_response_capture(q.run_id,r.request_fingerprint,q.work_claim_id,q.registration_id,q.endpoint_sha256);
 if exists(select 1 from terra_private.source_response_reservations where id=q.id and xmin=pg_current_xact_id()::xid) then
  raise exception 'Fictional response confirmation requires prior COMMIT' using errcode='23514';
 end if;
 if p_phase='reserve' and incoming->>'status' in('reserved','existing') then
  expected:=terra_private.response_reservation_receipt(q.id,incoming->>'status');
 elsif p_phase='dispatch' and incoming->>'status' in('dispatched','existing') then
  select * into d from terra_private.source_response_dispatches where reservation_id=q.id;
  if d.reservation_id is null or exists(select 1 from terra_private.source_response_dispatches
    where reservation_id=q.id and xmin=pg_current_xact_id()::xid) then
   raise exception 'Fictional dispatch confirmation requires prior COMMIT' using errcode='23514';
  end if;
  expected:=jsonb_build_object('schemaVersion',1,'status',incoming->>'status','reservationId',q.id,'runId',q.run_id,
   'requestFingerprint',r.request_fingerprint,'workClaimId',d.work_claim_id,'dispatchedAt',d.dispatched_at);
 elsif p_phase='settle' and incoming->>'status' in('settled','existing') then
  select * into s from terra_private.source_response_settlements where reservation_id=q.id;
  if s.reservation_id is null or exists(select 1 from terra_private.source_response_settlements
    where reservation_id=q.id and xmin=pg_current_xact_id()::xid) then
   raise exception 'Fictional settlement confirmation requires prior COMMIT' using errcode='23514';
  end if;
  expected:=jsonb_build_object('schemaVersion',1,'status',incoming->>'status','reservationId',q.id,'runId',q.run_id,
   'requestFingerprint',r.request_fingerprint,'workClaimId',s.work_claim_id,'outcome',s.outcome,
   'bodyBytes',s.body_bytes,'chargedBytes',case when s.outcome='measured' then s.body_bytes else q.max_body_bytes+1 end,
   'contentSha256',s.content_sha256,'settledAt',s.settled_at);
 end if;
 if expected is null or incoming is distinct from expected then
  raise exception 'Fictional confirmation does not match stored response receipt' using errcode='23514';
 end if;
 observed:=clock_timestamp();expires:=least(p.expires_at,w.lease_expires_at,w.deadline_at);
 if observed>=expires then
  raise exception 'Fictional response authority expired before confirmation' using errcode='42501';
 end if;
 return jsonb_build_object('schemaVersion',1,'phase',p_phase,'principal',session_user,
  'reservationId',q.id,'runId',q.run_id,'workClaimId',q.work_claim_id,'registrationId',q.registration_id,
  'maxBodyBytes',q.max_body_bytes,'endpointSha256',q.endpoint_sha256,
  'receiptSha256',encode(sha256(convert_to(p_receipt,'UTF8')),'hex'),
  'observedAt',observed,'authorityExpiresAt',expires);
end;
$confirm$;
revoke all on function terra_capture_test_api.confirm_response(text,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_capture_test_api.check_response_source_check()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype;
 q terra_private.source_response_reservations%rowtype;
 s terra_private.source_response_settlements%rowtype;
 source terra_private.source_registrations%rowtype;
 charged bigint;
begin
 if session_user not in('postgres','supabase_admin') then
  declare authority terra_capture_test_api.principal_scopes%rowtype;
  begin
   authority:=terra_capture_test_api.current_scope();
   if authority.run_id is distinct from new.run_id or authority.work_claim_id is distinct from new.work_claim_id then
    raise exception 'Capture COMMIT is outside principal scope' using errcode='42501';
   end if;
  end;
 end if;
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
drop trigger response_source_check_commit_guard on terra_private.update_run_source_checks;
create constraint trigger response_source_check_commit_guard after insert on terra_private.update_run_source_checks
 deferrable initially deferred for each row execute function terra_capture_test_api.check_response_source_check();

create function terra_capture_test_api.check_run_closeout()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 m terra_private.update_run_manifests%rowtype;
begin
 if session_user not in('postgres','supabase_admin') then
  declare authority terra_capture_test_api.principal_scopes%rowtype;
  begin
   authority:=terra_capture_test_api.current_scope();
   if authority.run_id is distinct from new.run_id or authority.work_claim_id is distinct from new.work_claim_id then
    raise exception 'Capture COMMIT is outside principal scope' using errcode='42501';
   end if;
  end;
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Processing writes require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 select * into w from terra_private.update_run_work_state where run_id=new.run_id for update;
 select * into m from terra_private.update_run_manifests where run_id=new.run_id;
 if r.id is null or w.run_id is null or m.run_id is null or new.work_claim_id is distinct from w.claim_id
    or new.manifest_sha256 is distinct from m.manifest_sha256
    or new.finished_at<m.captured_at or new.finished_at<w.updated_at or new.finished_at>clock_timestamp()
    or clock_timestamp()>=w.lease_expires_at or clock_timestamp()>=w.deadline_at
    or new.summary is distinct from terra_private.summarize_run_processing(new.run_id) then
   raise exception 'Closeout does not match current work and stored receipts' using errcode='23514';
 end if;
 if tg_when='BEFORE' then
   if r.run_state<>'running' or r.finished_at is not null then
     raise exception 'Run is not open for closeout' using errcode='23514';
   end if;
 elsif r.run_state is distinct from new.summary->>'runState'
    or r.commit_state is distinct from new.summary->>'commitState'
    or r.visibility_state is distinct from new.summary->>'visibilityState'
    or r.finished_at is distinct from new.finished_at then
   raise exception 'Run and closeout differ at transaction end' using errcode='23514';
 end if;
 return new;
end;
$guard$;
drop trigger run_closeout_commit_guard on terra_private.update_run_closeouts;
create constraint trigger run_closeout_commit_guard after insert on terra_private.update_run_closeouts
 deferrable initially deferred for each row execute function terra_capture_test_api.check_run_closeout();

-- Additional shadow-only operations. No qualification, decision or activation
-- writer. Caller cannot choose the run, source, version, item or endpoint.
create function terra_capture_test_api.store_capture(p_body_hex text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $capture$
declare p terra_capture_test_api.principal_scopes%rowtype;
 q terra_private.source_response_reservations%rowtype;
 s terra_private.source_response_settlements%rowtype;
 body bytea; fingerprint text;
begin
 p:=terra_capture_test_api.current_scope();
 select request_fingerprint into fingerprint from terra_private.update_runs where id=p.run_id;
 perform terra_private.assert_update_run_work(p.run_id,fingerprint,p.work_claim_id);
 if p_body_hex is null or octet_length(p_body_hex)<>2*p.body_bytes or p_body_hex!~'^[0-9a-f]+$' then
  raise exception 'Captured fixture bytes do not match trusted size' using errcode='23514';
 end if;
 body:=decode(p_body_hex,'hex');
 if encode(sha256(body),'hex') is distinct from p.body_sha256 then
  raise exception 'Captured fixture bytes do not match trusted hash' using errcode='23514';
 end if;
 select * into q from terra_private.source_response_reservations where run_id=p.run_id and registration_id=p.registration_id order by reserved_at desc,id desc limit 1;
 select * into s from terra_private.source_response_settlements where reservation_id=q.id;
 if q.id is null or s.reservation_id is null or s.outcome<>'measured' or s.content_sha256 is distinct from p.body_sha256
  or s.body_bytes<>p.body_bytes or s.work_claim_id is distinct from p.work_claim_id
  or exists(select 1 from terra_private.source_response_settlements where reservation_id=q.id and xmin=pg_current_xact_id()::xid) then
  raise exception 'Captured fixture has no committed measured settlement' using errcode='23514';
 end if;
 if not exists(select 1 from terra_private.update_run_source_checks where run_id=p.run_id and registration_id=p.registration_id) then
  insert into terra_private.source_versions(id,registration_id,item_key,source_url,retrieved_at,content_sha256)
   select p.source_version_id,p.registration_id,p.item_key,exact_endpoint,s.settled_at,p.body_sha256
   from terra_private.source_registrations where id=p.registration_id;
  insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,source_version_id,content_sha256,outcome,total_response_bytes,work_claim_id)
   select p.run_id,p.registration_id,source_key,p.source_version_id,p.body_sha256,'captured',s.body_bytes,p.work_claim_id
   from terra_private.source_registrations where id=p.registration_id;
 end if;
 return jsonb_build_object('stored',true);
end;
$capture$;

create function terra_capture_test_api.store_manifest(p_canonical text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $manifest$
declare p terra_capture_test_api.principal_scopes%rowtype; m jsonb;
 expected_sources jsonb; expected_items jsonb; fingerprint text;
begin
 p:=terra_capture_test_api.current_scope();
 select request_fingerprint into fingerprint from terra_private.update_runs where id=p.run_id;
 perform terra_private.assert_update_run_work(p.run_id,fingerprint,p.work_claim_id);
 m:=terra_private.validate_run_manifest(p_canonical);
 expected_sources:=jsonb_build_array(jsonb_build_object('sourceKey','fictional-response','registrationId',p.registration_id,
   'sourceVersionId',p.source_version_id,'contentSha256',p.body_sha256));
 expected_items:=jsonb_build_array(jsonb_build_object('itemKey',p.item_key,'sourceKey','fictional-response','sourceVersionId',p.source_version_id));
 if m->>'runId' is distinct from p.run_id::text or m->>'requestFingerprint' is distinct from fingerprint
  or m->>'mode' is distinct from 'shadow' or m->'sources' is distinct from expected_sources or m->'items' is distinct from expected_items then
  raise exception 'Captured manifest differs from the trusted single-fixture plan' using errcode='42501';
 end if;
 if not exists(select 1 from terra_private.update_run_manifests where run_id=p.run_id) then
  insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id)
   values(p.run_id,p_canonical,encode(sha256(convert_to(p_canonical,'UTF8')),'hex'),p.work_claim_id);
 elsif not exists(select 1 from terra_private.update_run_manifests where run_id=p.run_id and canonical_manifest=p_canonical and work_claim_id=p.work_claim_id) then
  raise exception 'Captured manifest retry differs from original' using errcode='23514';
 end if;
 return jsonb_build_object('stored',true);
end;
$manifest$;

create function terra_capture_test_api.read_checkpoint(p_phase text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $read$
declare p terra_capture_test_api.principal_scopes%rowtype; result jsonb;
begin
 p:=terra_capture_test_api.current_scope();
 if p_phase='capture' then
  select jsonb_build_object('schemaVersion',1,'runId',run_id,'workClaimId',work_claim_id,'registrationId',registration_id,
   'sourceKey',source_key,'sourceVersionId',source_version_id,'contentSha256',content_sha256,'outcome',outcome,
   'totalResponseBytes',total_response_bytes,'checkedAt',checked_at) into result
   from terra_private.update_run_source_checks where run_id=p.run_id and registration_id=p.registration_id
    and xmin<>pg_current_xact_id()::xid;
 elsif p_phase='manifest' then
  select jsonb_build_object('schemaVersion',1,'runId',run_id,'workClaimId',work_claim_id,'canonicalManifest',canonical_manifest,'manifestSha256',manifest_sha256)
   into result from terra_private.update_run_manifests where run_id=p.run_id and xmin<>pg_current_xact_id()::xid;
 elsif p_phase='processing' then
  result:=jsonb_build_object('decisions','[]'::jsonb,'activations','[]'::jsonb,'invalidSourceKeys',terra_private.summarize_run_processing(p.run_id)->'invalidSourceKeys');
 elsif p_phase='close' then
  select jsonb_build_object('schemaVersion',1,'status','existing_closeout','runId',c.run_id,'requestFingerprint',r.request_fingerprint,
   'workClaimId',c.work_claim_id,'manifestSha256',c.manifest_sha256,'finishedAt',c.finished_at,'summary',c.summary)
   into result from terra_private.update_run_closeouts c join terra_private.update_runs r on r.id=c.run_id
   where c.run_id=p.run_id and c.xmin<>pg_current_xact_id()::xid;
 else
  raise exception 'Unknown capture checkpoint' using errcode='23514';
 end if;
 if result is null then raise exception 'Committed capture checkpoint is missing' using errcode='23514'; end if;
 return result;
end;
$read$;

create function terra_capture_test_api.close_processing(p_manifest_sha256 text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $close$
declare p terra_capture_test_api.principal_scopes%rowtype; fingerprint text;
begin
 p:=terra_capture_test_api.current_scope();
 select request_fingerprint into fingerprint from terra_private.update_runs where id=p.run_id;
 return terra_private.close_update_run_processing(p.run_id,fingerprint,p.work_claim_id,p_manifest_sha256);
end;
$close$;

-- New definer code is closed before any test-specific grant is made.
revoke all on all functions in schema terra_capture_test_api
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
