-- PRIVATE SSB CAPTURE API V2 CANDIDATE. No active migration or live grant.
-- ISOLATED EXACT-SOURCE RAW API CANDIDATE. No live/primary grant.
-- ISOLATED UNKNOWN-RAW CUSTODY CANDIDATE. No live source or primary changes.
-- ISOLATED UNKNOWN-FIRST-CAPTURE CANDIDATE; NO LIVE AUTHORITY.
-- ISOLATED SSB-FORMAT FIXTURES ONLY. No primary/live collection or publication.
-- Fictional isolated identity experiment only. Not a primary/runtime proposal.
-- A real SCRAM login is mapped by SESSION_USER to one fictional run/source.
-- No client-supplied actor, run, role, registration, endpoint or policy input.
-- Execute under one owner transaction; PUBLIC revocation precedes any grant.

create schema terra_ssb_private_capture_api;
revoke all on schema terra_ssb_private_capture_api from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
create table terra_ssb_private_capture_api.principal_scopes (
 principal name not null,
 response_kind text not null check(response_kind in('metadata','data')),
 run_id uuid not null references terra_private.update_runs(id),
 registration_id uuid not null references terra_private.source_registrations(id),
 actor_id text not null check(actor_id='runner:fictional'),
 scope text not null check(scope='fictional-country'),
 max_body_bytes integer not null check(max_body_bytes=65536),
 expires_at timestamptz not null check(isfinite(expires_at)),
 enabled boolean not null default false,
 retain_raw boolean not null default false,
 source_inventory_sha256 text not null check(source_inventory_sha256~'^[0-9a-f]{64}$'),
 work_claim_id uuid not null references terra_private.update_run_work_claims(id),
 source_version_id uuid not null,
 body_sha256 text check(body_sha256~'^[0-9a-f]{64}$'),
 body_bytes integer check(body_bytes between 1 and 65536),
 pair_id uuid not null,
 trusted_manifest text check(octet_length(trusted_manifest) between 2 and 32768),
 primary key(principal,response_kind),unique(principal,registration_id)
);
alter table terra_ssb_private_capture_api.principal_scopes enable row level security;
revoke all on terra_ssb_private_capture_api.principal_scopes from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_ssb_private_capture_api.current_scope(p_kind text)
returns terra_ssb_private_capture_api.principal_scopes language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $scope$
declare p terra_ssb_private_capture_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; s terra_private.source_registrations%rowtype;
begin
 -- Trust/peer connections cannot be relabelled as authenticated SCRAM calls.
 if system_user is distinct from 'scram-sha-256:'||session_user::text then
  raise exception 'Authenticated fictional response identity required' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in('metadata','data') then
  raise exception 'Unknown closed pair response kind' using errcode='42501';
 end if;
 -- Serialize the whole principal before native run locks, preserving the
 -- previously verified lock order for operations on either context.
 perform 1 from terra_ssb_private_capture_api.principal_scopes where principal=session_user order by response_kind for no key update;
 select * into p from terra_ssb_private_capture_api.principal_scopes where principal=session_user and response_kind=p_kind;

 if p.principal is null or not p.enabled or clock_timestamp()>=p.expires_at then
  raise exception 'Fictional response principal has no active scope' using errcode='42501';
 end if;
 if (select count(*) from terra_ssb_private_capture_api.principal_scopes where principal=session_user)<>2
  or exists(select 1 from terra_ssb_private_capture_api.principal_scopes peer where peer.principal=session_user
   and (peer.source_inventory_sha256 is distinct from p.source_inventory_sha256
        or peer.run_id is distinct from p.run_id or peer.work_claim_id is distinct from p.work_claim_id
        or peer.pair_id is distinct from p.pair_id or not peer.enabled or not peer.retain_raw
        or clock_timestamp()>=peer.expires_at)) then
  raise exception 'Paired source identity is not fully bound' using errcode='42501';
 end if;

 perform 1 from terra_private.source_registrations registration
  join terra_ssb_private_capture_api.principal_scopes peer on peer.registration_id=registration.id
  where peer.principal=session_user order by registration.id for share of registration;
 if exists(select 1 from terra_ssb_private_capture_api.principal_scopes peer
  left join terra_private.source_registrations registration on registration.id=peer.registration_id
  where peer.principal=session_user and (registration.id is null
   or registration.registration_state<>'approved' or not registration.allow_fetch
   or not registration.fetch_enabled or not registration.allow_retain
   or registration.reviewed_at is null or not isfinite(registration.reviewed_at)
   or registration.reviewed_at>clock_timestamp()
   or registration.allow_public_derived
   or registration.source_key is distinct from ('ssb-14059-'||peer.response_kind)
   or registration.exact_endpoint is distinct from (case when peer.response_kind='metadata'
    then 'https://data.ssb.no/api/pxwebapi/v2/tables/14059/metadata?lang=en' else 'https://data.ssb.no/api/pxwebapi/v2/tables/14059/data?lang=en&valueCodes%5BEierStatus%5D=0&valueCodes%5BContentsCode%5D=Boutg4%2CBoutg5%2CAntHushSvar&valueCodes%5BTid%5D=2024%2C2025' end))) then
  raise exception 'Current paired source retention rights are unavailable' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into s from terra_private.source_registrations where id=p.registration_id;
 if r.requested_by is distinct from p.actor_id or r.jurisdiction_id is distinct from p.scope
  or r.code_version is distinct from ('ssb-sha256:'||p.source_inventory_sha256)
  or (select canonical_request::jsonb->>'trigger' from terra_private.update_run_requests where run_id=r.id) is distinct from 'manual'
  or (select canonical_request::jsonb->'scheduled_due_at' from terra_private.update_run_requests where run_id=r.id) is distinct from 'null'::jsonb
  or (r.limits->>'max_retries')::integer is distinct from 0
  or (r.limits->>'max_model_calls')::integer is distinct from 0
  or (r.limits->>'max_items')::integer is distinct from 3
  or (r.limits->>'max_response_bytes')::integer is distinct from 131074
  or (select attempt_no from terra_private.update_run_work_claims where id=p.work_claim_id) is distinct from 1
  or r.mode<>'shadow' or s.source_key is distinct from ('ssb-14059-'||p_kind)
  or s.exact_endpoint is distinct from (case when p_kind='metadata' then 'https://data.ssb.no/api/pxwebapi/v2/tables/14059/metadata?lang=en' else 'https://data.ssb.no/api/pxwebapi/v2/tables/14059/data?lang=en&valueCodes%5BEierStatus%5D=0&valueCodes%5BContentsCode%5D=Boutg4%2CBoutg5%2CAntHushSvar&valueCodes%5BTid%5D=2024%2C2025' end)
  or s.registration_state<>'approved' or not s.allow_fetch or not s.fetch_enabled or s.allow_public_derived
  or p.work_claim_id is distinct from (select claim_id from terra_private.update_run_work_state where run_id=p.run_id)
  or p.body_sha256 is not null or p.body_bytes is not null or p.trusted_manifest is not null then
  raise exception 'Fictional response scope does not match trusted run/source' using errcode='42501';
 end if;
 return p;
end;
$scope$;

create function terra_ssb_private_capture_api.reserve_response(p_kind text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $reserve$
declare p terra_ssb_private_capture_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 p_key text;p_max_body integer;
begin
 p:=terra_ssb_private_capture_api.current_scope(p_kind);
 p_key:='ssb-14059:private:'||p_kind;p_max_body:=p.max_body_bytes;
 if p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then
  raise exception 'Fictional response bound exceeds principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 return terra_private.reserve_source_response(p.run_id,r.request_fingerprint,w.claim_id,p.registration_id,p_key,p_max_body);
end;
$reserve$;

create function terra_ssb_private_capture_api.dispatch_response(p_kind text,p_reservation uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $dispatch$
declare p terra_ssb_private_capture_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 q terra_private.source_response_reservations%rowtype;
begin
 p:=terra_ssb_private_capture_api.current_scope(p_kind);
 select * into q from terra_private.source_response_reservations where id=p_reservation;
 if q.id is null or q.run_id is distinct from p.run_id or q.registration_id is distinct from p.registration_id then
  raise exception 'Fictional response reservation is outside principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 return terra_private.dispatch_source_response(p.run_id,r.request_fingerprint,w.claim_id,p_reservation);
end;
$dispatch$;

create function terra_ssb_private_capture_api.settle_response(p_kind text,p_reservation uuid,p_outcome text,p_body_bytes integer,p_hash text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $settle$
declare p terra_ssb_private_capture_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 q terra_private.source_response_reservations%rowtype;
begin
 p:=terra_ssb_private_capture_api.current_scope(p_kind);
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

revoke all on function terra_ssb_private_capture_api.current_scope(text),
 terra_ssb_private_capture_api.reserve_response(text),terra_ssb_private_capture_api.dispatch_response(text,uuid),
 terra_ssb_private_capture_api.settle_response(text,uuid,text,integer,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
-- Test-specific LOGIN creation, scope seeding and three exact grants are supplied
-- by a fixed acceptance harness, with ephemeral passwords never written/logged.

-- Additive isolated identity experiment only, not the owner-only primary draft.
-- Deferred triggers execute after the caller has left the definer wrapper.
-- Keep original invoker BEFORE checks. Replace only the three deferred bindings
-- with closed definer copies that validate authenticated scope again at COMMIT.
-- No table grant, general invoker grant, deadline bypass or source activation.

create function terra_ssb_private_capture_api.validate_commit_scope(p_run uuid,p_registration uuid,p_max_body integer)
returns void language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $scope$
declare p terra_ssb_private_capture_api.principal_scopes%rowtype;
begin
 -- Isolated owner fixtures retain their existing direct owner route.
 if session_user in ('postgres','supabase_admin') then return; end if;
 p:=terra_ssb_private_capture_api.current_scope((select response_kind from terra_ssb_private_capture_api.principal_scopes where principal=session_user and registration_id=p_registration));
 if p.run_id is distinct from p_run or p.registration_id is distinct from p_registration
  or p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then
  raise exception 'Fictional response commit is outside principal scope' using errcode='42501';
 end if;
end;
$scope$;

create function terra_ssb_private_capture_api.check_reservation_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; c terra_private.update_run_work_claims%rowtype;
 count_source integer; count_run integer;
begin
 perform terra_ssb_private_capture_api.validate_commit_scope(new.run_id,new.registration_id,new.max_body_bytes);
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
 deferrable initially deferred for each row execute function terra_ssb_private_capture_api.check_reservation_commit();

create function terra_ssb_private_capture_api.check_dispatch_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 perform terra_ssb_private_capture_api.validate_commit_scope(q.run_id,q.registration_id,q.max_body_bytes);
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
 deferrable initially deferred for each row execute function terra_ssb_private_capture_api.check_dispatch_commit();

create function terra_ssb_private_capture_api.check_settlement_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype;
 d terra_private.source_response_dispatches%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 perform terra_ssb_private_capture_api.validate_commit_scope(q.run_id,q.registration_id,q.max_body_bytes);
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
 deferrable initially deferred for each row execute function terra_ssb_private_capture_api.check_settlement_commit();

revoke all on function terra_ssb_private_capture_api.validate_commit_scope(uuid,uuid,integer),
 terra_ssb_private_capture_api.check_reservation_commit(),terra_ssb_private_capture_api.check_dispatch_commit(),
 terra_ssb_private_capture_api.check_settlement_commit()
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

-- Isolated experiment only: fresh authority read AFTER the fixed adapter has
-- committed its operation. This adds no DML grant or general SQL permission.
-- A confirmation binds a saved receipt; it is not a fresh dispatch permission.
create function terra_ssb_private_capture_api.confirm_response(p_kind text,p_phase text,p_receipt text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $confirm$
declare p terra_ssb_private_capture_api.principal_scopes%rowtype;
 q terra_private.source_response_reservations%rowtype;
 d terra_private.source_response_dispatches%rowtype;
 s terra_private.source_response_settlements%rowtype;
 r terra_private.update_runs%rowtype;w terra_private.update_run_work_state%rowtype;
 incoming jsonb; expected jsonb; observed timestamptz; expires timestamptz;
begin
 p:=terra_ssb_private_capture_api.current_scope(p_kind);
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
revoke all on function terra_ssb_private_capture_api.confirm_response(text,text,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_ssb_private_capture_api.check_response_source_check()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype;
 q terra_private.source_response_reservations%rowtype;
 s terra_private.source_response_settlements%rowtype;
 source terra_private.source_registrations%rowtype;
 charged bigint;
begin
 if session_user not in('postgres','supabase_admin') then
  declare authority terra_ssb_private_capture_api.principal_scopes%rowtype;
  begin
   authority:=terra_ssb_private_capture_api.current_scope('metadata');
   if authority.run_id is distinct from new.run_id then
    raise exception 'Pair COMMIT is outside authenticated run' using errcode='42501';
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
 deferrable initially deferred for each row execute function terra_ssb_private_capture_api.check_response_source_check();

create function terra_ssb_private_capture_api.check_source_pair_run_binding()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $guard$
declare p terra_private.source_response_pairs%rowtype; r terra_private.update_runs%rowtype;
 c terra_private.update_run_source_checks%rowtype; v terra_private.source_versions%rowtype;
 registration terra_private.source_registrations%rowtype;
 reservation terra_private.source_response_reservations%rowtype;
 measured terra_private.source_response_settlements%rowtype;
 dispatched terra_private.source_response_dispatches%rowtype;
 kind text; context_registration_id uuid; version_id uuid; source_key text; retrieved_at timestamptz;
begin
 if session_user not in('postgres','supabase_admin') then
  declare authority terra_ssb_private_capture_api.principal_scopes%rowtype;
  begin
   authority:=terra_ssb_private_capture_api.current_scope('metadata');
   if authority.run_id is distinct from new.run_id then
    raise exception 'Pair COMMIT is outside authenticated run' using errcode='42501';
   end if;
  end;
 end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Response pair bindings require read committed isolation' using errcode='23514';
 end if;
 select * into r from terra_private.update_runs where id=new.run_id for update;
 perform terra_private.assert_update_run_work(r.id,r.request_fingerprint,new.work_claim_id);
 select * into p from terra_private.source_response_pairs where id=new.pair_id for share;
 if p.id is null or p.metadata_registration_id=p.registration_id
  or new.bound_at<greatest(p.created_at,r.created_at) or new.bound_at>clock_timestamp()
  or (tg_when='BEFORE' and (exists(select 1 from terra_private.update_run_manifests where run_id=r.id)
  or exists(select 1 from terra_private.machine_candidate_decisions where run_id=r.id))) then
  raise exception 'Response pair binding is outside open captured work' using errcode='23514';
 end if;
 -- Current fixed retrieval rights are locked through the binding transaction.
 perform 1 from terra_private.source_registrations where id in(p.metadata_registration_id,p.registration_id)
  order by id for share;
 foreach kind in array array['metadata','data'] loop
  context_registration_id:=case when kind='metadata' then p.metadata_registration_id else p.registration_id end;
  version_id:=case when kind='metadata' then p.metadata_version_id else p.data_version_id end;
  source_key:=case when kind='metadata' then new.metadata_source_key else new.data_source_key end;
  retrieved_at:=case when kind='metadata' then p.metadata_retrieved_at else p.data_retrieved_at end;
  select * into registration from terra_private.source_registrations where id=context_registration_id;
  select * into c from terra_private.update_run_source_checks where run_id=r.id and update_run_source_checks.registration_id=context_registration_id;
  select * into v from terra_private.source_versions where id=version_id;
  select * into reservation from terra_private.source_response_reservations
   where run_id=r.id and source_response_reservations.registration_id=context_registration_id order by reserved_at desc,id desc limit 1;
  select * into measured from terra_private.source_response_settlements where reservation_id=reservation.id;
  select * into dispatched from terra_private.source_response_dispatches where reservation_id=reservation.id;
  if registration.id is null or registration.source_key is distinct from source_key
   or registration.registration_state<>'approved' or not registration.allow_fetch or not registration.fetch_enabled
   or registration.reviewed_at is null or registration.reviewed_at>new.bound_at
   or c.run_id is null or c.source_key is distinct from source_key or c.source_version_id is distinct from version_id
   or c.work_claim_id is distinct from new.work_claim_id or c.outcome not in('captured','unchanged')
   or c.checked_at>new.bound_at or v.id is null or v.registration_id is distinct from context_registration_id
   or v.source_url is distinct from registration.exact_endpoint or v.content_sha256 is distinct from c.content_sha256
   or reservation.id is null or dispatched.reservation_id is null or measured.reservation_id is null
   or reservation.work_claim_id is distinct from new.work_claim_id or measured.outcome<>'measured'
   or measured.content_sha256 is distinct from v.content_sha256 or measured.body_bytes>reservation.max_body_bytes
   or reservation.endpoint_sha256 is distinct from encode(sha256(convert_to(registration.exact_endpoint,'UTF8')),'hex')
   or retrieved_at<dispatched.dispatched_at or retrieved_at>measured.settled_at
   or v.retrieved_at>retrieved_at or (c.outcome='captured' and v.retrieved_at<>retrieved_at)
   or c.total_response_bytes is distinct from (select coalesce(sum(case when s.outcome='measured' then s.body_bytes else q.max_body_bytes+1 end),0)
       from terra_private.source_response_reservations q left join terra_private.source_response_settlements s on s.reservation_id=q.id
       where q.run_id=r.id and q.registration_id=context_registration_id) then
   raise exception 'Response pair does not match both committed capture contexts' using errcode='23514';
  end if;
 end loop;
 return new;
end;
$guard$;
drop trigger response_pair_run_binding_commit on terra_private.source_pair_run_bindings;
create constraint trigger response_pair_run_binding_commit after insert on terra_private.source_pair_run_bindings
 deferrable initially deferred for each row execute function terra_ssb_private_capture_api.check_source_pair_run_binding();

create function terra_ssb_private_capture_api.require_response_pair_context_binding()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $guard$
begin
 if session_user not in('postgres','supabase_admin') then
  declare authority terra_ssb_private_capture_api.principal_scopes%rowtype;
  begin
   authority:=terra_ssb_private_capture_api.current_scope('metadata');
   if authority.run_id is distinct from (select run_id from terra_private.source_pair_run_bindings where pair_id=new.id) then
    raise exception 'Pair COMMIT is outside authenticated run' using errcode='42501';
   end if;
  end;
 end if;
 if new.metadata_registration_id<>new.registration_id and not exists(
  select 1 from terra_private.source_pair_run_bindings where pair_id=new.id) then
  raise exception 'Two-context response pair needs its committed run binding' using errcode='23514';
 end if;
 return new;
end;
$guard$;
drop trigger response_pair_context_binding_commit on terra_private.source_response_pairs;
create constraint trigger response_pair_context_binding_commit after insert or update on terra_private.source_response_pairs
 deferrable initially deferred for each row execute function terra_ssb_private_capture_api.require_response_pair_context_binding();

create function terra_ssb_private_capture_api.check_run_closeout()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 m terra_private.update_run_manifests%rowtype;
begin
 if session_user not in('postgres','supabase_admin') then
  declare authority terra_ssb_private_capture_api.principal_scopes%rowtype;
  begin
   authority:=terra_ssb_private_capture_api.current_scope('metadata');
   if authority.run_id is distinct from new.run_id then
    raise exception 'Pair COMMIT is outside authenticated run' using errcode='42501';
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
 deferrable initially deferred for each row execute function terra_ssb_private_capture_api.check_run_closeout();

-- ISOLATED first-capture candidate: response hashes are not preprovisioned.
-- Committed measured receipts bind unknown bounded bytes to fixed contexts.
-- No source fetch, usable assessment, checkpoint or publication authority.
create function terra_ssb_private_capture_api.store_pair(p_metadata_hex text,p_data_hex text,
 p_metadata_time timestamptz,p_data_time timestamptz,p_manifest text,p_raw_attempt text,p_stored_at timestamptz)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $store$
declare m terra_ssb_private_capture_api.principal_scopes%rowtype;
 d terra_ssb_private_capture_api.principal_scopes%rowtype;
 c terra_ssb_private_capture_api.principal_scopes%rowtype;
 q terra_private.source_response_reservations%rowtype;
 s terra_private.source_response_settlements%rowtype;
 p terra_private.source_response_pairs%rowtype;
 fingerprint text;body bytea;retrieved timestamptz;hex_body text;
 expected jsonb; sources jsonb; supplied jsonb;
begin
 m:=terra_ssb_private_capture_api.current_scope('metadata');
 d:=terra_ssb_private_capture_api.current_scope('data');
 if not m.retain_raw or not d.retain_raw or p_raw_attempt is null or p_raw_attempt!~'^[0-9a-f]{32}$'
  or p_stored_at is null or not isfinite(p_stored_at) or p_stored_at>clock_timestamp() then
  raise exception 'Trusted private raw custody is required' using errcode='23514';
 end if;
 if m.run_id is distinct from d.run_id or m.work_claim_id is distinct from d.work_claim_id
  or m.pair_id is distinct from d.pair_id
  or m.registration_id=d.registration_id or m.source_version_id=d.source_version_id then
  raise exception 'Paired store differs from both trusted contexts' using errcode='42501';
 end if;
 if p_metadata_hex is null or p_data_hex is null or octet_length(p_metadata_hex) not between 2 and 131072
  or octet_length(p_data_hex) not between 2 and 131072 or length(p_metadata_hex)%2<>0 or length(p_data_hex)%2<>0
  or p_metadata_hex!~'^[0-9a-f]+$' or p_data_hex!~'^[0-9a-f]+$'
  or p_metadata_time is null or p_data_time is null or not isfinite(p_metadata_time) or not isfinite(p_data_time) then
  raise exception 'Bounded first-capture bytes/time required' using errcode='23514';
 end if;
 supplied:=terra_private.validate_run_manifest(p_manifest);
 select request_fingerprint into fingerprint from terra_private.update_runs where id=m.run_id;
 perform terra_private.assert_update_run_work(m.run_id,fingerprint,m.work_claim_id);
 -- Derive the expected first-capture manifest from fixed owner contexts and
 -- actual committed measurements; no worker-selected item or approval exists.
 select jsonb_agg(jsonb_build_object('sourceKey',r.source_key,'registrationId',authority_row.registration_id,
  'sourceVersionId',authority_row.source_version_id,'contentSha256',receipt.content_sha256) order by r.source_key collate "C")
 into sources from terra_ssb_private_capture_api.principal_scopes authority_row
 join terra_private.source_registrations r on r.id=authority_row.registration_id
 join terra_private.source_response_reservations reserved_row on reserved_row.run_id=authority_row.run_id and reserved_row.registration_id=authority_row.registration_id
 join terra_private.source_response_settlements receipt on receipt.reservation_id=reserved_row.id
 where authority_row.principal=session_user and receipt.outcome='measured';
 expected:=jsonb_build_object('schemaVersion',1,'runId',m.run_id,'requestFingerprint',fingerprint,'mode','shadow',
  'sources',sources,'items',jsonb_build_array(
   jsonb_build_object('itemKey','ssb-14059-metadata-review','sourceKey','ssb-14059-metadata','sourceVersionId',m.source_version_id),
   jsonb_build_object('itemKey','ssb-14059-year-2024','sourceKey','ssb-14059-data','sourceVersionId',d.source_version_id),
   jsonb_build_object('itemKey','ssb-14059-year-2025','sourceKey','ssb-14059-data','sourceVersionId',d.source_version_id)));
 if sources is null or jsonb_array_length(sources)<>2 or supplied is distinct from expected then
  raise exception 'First-capture manifest differs from actual measured contexts' using errcode='23514';
 end if;
 if exists(select 1 from terra_private.source_response_pairs where id=m.pair_id) then
  select * into p from terra_private.source_response_pairs where id=m.pair_id;
  if p.registration_id is distinct from d.registration_id or p.metadata_registration_id is distinct from m.registration_id
   or p.metadata_version_id is distinct from m.source_version_id or p.data_version_id is distinct from d.source_version_id
   or p.metadata_retrieved_at is distinct from p_metadata_time or p.data_retrieved_at is distinct from p_data_time
   or not exists(select 1 from terra_private.update_run_manifests where run_id=m.run_id and canonical_manifest=p_manifest)
   or not exists(select 1 from terra_private.source_raw_pair_artifacts a where a.pair_id=m.pair_id
     and a.raw_attempt_id=p_raw_attempt and a.stored_at=p_stored_at)
   or encode(sha256(decode(p_metadata_hex,'hex')),'hex') is distinct from
      (select content_sha256 from terra_private.source_versions where id=m.source_version_id)
   or encode(sha256(decode(p_data_hex,'hex')),'hex') is distinct from
      (select content_sha256 from terra_private.source_versions where id=d.source_version_id) then
   raise exception 'Paired store replay differs from preserved pair' using errcode='23514';
  end if;
  return jsonb_build_object('stored',true,'status','existing');
 end if;
 for c in select * from terra_ssb_private_capture_api.principal_scopes
   where principal=session_user order by response_kind loop
  hex_body:=case when c.response_kind='metadata' then p_metadata_hex else p_data_hex end;
  retrieved:=case when c.response_kind='metadata' then p_metadata_time else p_data_time end;
  if hex_body is null or octet_length(hex_body) not between 2 and 131072 or hex_body!~'^[0-9a-f]+$'
   or retrieved is null or not isfinite(retrieved) then
   raise exception 'Paired capture body/time is invalid' using errcode='23514';
  end if;
  body:=decode(hex_body,'hex');
  select * into q from terra_private.source_response_reservations
   where run_id=c.run_id and registration_id=c.registration_id;
  select * into s from terra_private.source_response_settlements where reservation_id=q.id;
  if q.id is null or s.reservation_id is null or s.outcome<>'measured'
   or encode(sha256(body),'hex') is distinct from s.content_sha256 or octet_length(body) is distinct from s.body_bytes
   or q.work_claim_id is distinct from c.work_claim_id
   or exists(select 1 from terra_private.source_response_settlements where reservation_id=q.id and xmin=pg_current_xact_id()::xid) then
   raise exception 'Paired capture differs from committed measured response' using errcode='23514';
  end if;
  insert into terra_private.source_versions(id,registration_id,item_key,source_url,retrieved_at,content_sha256)
   select c.source_version_id,c.registration_id,'ssb-14059:private-pair:'||source_key,exact_endpoint,retrieved,s.content_sha256
   from terra_private.source_registrations where id=c.registration_id;
  insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,source_version_id,
   content_sha256,outcome,total_response_bytes,work_claim_id)
   select c.run_id,c.registration_id,source_key,c.source_version_id,s.content_sha256,'captured',s.body_bytes,c.work_claim_id
   from terra_private.source_registrations where id=c.registration_id;
 end loop;
 insert into terra_private.source_response_pairs(id,registration_id,metadata_registration_id,attempt_key,
  metadata_version_id,data_version_id,metadata_retrieved_at,data_retrieved_at)
 values(m.pair_id,d.registration_id,m.registration_id,'ssb-14059:private-pair:'||m.run_id::text,
  m.source_version_id,d.source_version_id,p_metadata_time,p_data_time);
 insert into terra_private.source_pair_run_bindings(pair_id,run_id,work_claim_id,metadata_source_key,data_source_key)
 values(m.pair_id,m.run_id,m.work_claim_id,'ssb-14059-metadata','ssb-14059-data');
 insert into terra_private.source_raw_pair_artifacts(pair_id,metadata_retrieved_at,data_retrieved_at,
  raw_attempt_id,metadata_sha256,data_sha256,stored_at,expires_at,metadata_version_id,data_version_id)
 values(m.pair_id,p_metadata_time,p_data_time,p_raw_attempt,
  encode(sha256(decode(p_metadata_hex,'hex')),'hex'),encode(sha256(decode(p_data_hex,'hex')),'hex'),
  p_stored_at,p_metadata_time+interval '720 hours',m.source_version_id,d.source_version_id);
 insert into terra_private.source_pair_validations(pair_id,registration_id,validation_state)
 values(m.pair_id,d.registration_id,'pending');
 insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id)
 values(m.run_id,p_manifest,encode(sha256(convert_to(p_manifest,'UTF8')),'hex'),m.work_claim_id);
 return jsonb_build_object('stored',true,'status','created');
end;
$store$;

create function terra_ssb_private_capture_api.read_pair_checkpoint()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $read$
declare m terra_ssb_private_capture_api.principal_scopes%rowtype;result jsonb;
begin
 m:=terra_ssb_private_capture_api.current_scope('metadata');
 perform terra_ssb_private_capture_api.current_scope('data');
 select jsonb_build_object('schemaVersion',1,'runId',f.run_id,'workClaimId',f.work_claim_id,
  'canonicalManifest',f.canonical_manifest,'manifestSha256',f.manifest_sha256,
  'pairId',p.id,'validationState',v.validation_state,
  'metadataVersionId',p.metadata_version_id,'dataVersionId',p.data_version_id)
 into result from terra_private.update_run_manifests f
 join terra_private.source_pair_run_bindings b on b.run_id=f.run_id and b.work_claim_id=f.work_claim_id
 join terra_private.source_response_pairs p on p.id=b.pair_id
 join terra_private.source_pair_validations v on v.pair_id=p.id
 where f.run_id=m.run_id and p.id=m.pair_id and f.xmin<>pg_current_xact_id()::xid
  and b.xmin<>pg_current_xact_id()::xid and p.xmin<>pg_current_xact_id()::xid;
 if result is null then raise exception 'Paired checkpoint requires prior COMMIT' using errcode='23514';end if;
 return result;
end;
$read$;

create function terra_ssb_private_capture_api.close_processing()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $close$
declare m terra_ssb_private_capture_api.principal_scopes%rowtype;fingerprint text;
begin
 m:=terra_ssb_private_capture_api.current_scope('metadata');
 perform terra_ssb_private_capture_api.current_scope('data');
 select request_fingerprint into fingerprint from terra_private.update_runs where id=m.run_id;
 perform terra_ssb_private_capture_api.read_pair_checkpoint();
 return terra_private.close_update_run_processing(m.run_id,fingerprint,m.work_claim_id,
  (select manifest_sha256 from terra_private.update_run_manifests where run_id=m.run_id));
end;
$close$;

create function terra_ssb_private_capture_api.read_closeout()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $close_read$
declare m terra_ssb_private_capture_api.principal_scopes%rowtype;result jsonb;
begin
 m:=terra_ssb_private_capture_api.current_scope('metadata');
 perform terra_ssb_private_capture_api.current_scope('data');
 select jsonb_build_object('schemaVersion',1,'status','existing_closeout','runId',c.run_id,
  'requestFingerprint',r.request_fingerprint,'workClaimId',c.work_claim_id,'manifestSha256',c.manifest_sha256,
  'finishedAt',c.finished_at,'summary',c.summary) into result
 from terra_private.update_run_closeouts c join terra_private.update_runs r on r.id=c.run_id
 where c.run_id=m.run_id and c.work_claim_id=m.work_claim_id and c.xmin<>pg_current_xact_id()::xid;
 if result is null then raise exception 'Paired closeout requires prior COMMIT' using errcode='23514';end if;
 return result;
end;
$close_read$;


create function terra_ssb_private_capture_api.read_raw_pair_binding()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $raw_read$
declare m terra_ssb_private_capture_api.principal_scopes%rowtype; result jsonb;
begin
 m:=terra_ssb_private_capture_api.current_scope('metadata');
 perform terra_ssb_private_capture_api.current_scope('data');
 select jsonb_build_object('schemaVersion',1,'pairId',a.pair_id,'rawAttemptId',a.raw_attempt_id,
  'metadataSha256',a.metadata_sha256,'dataSha256',a.data_sha256,'storedAt',a.stored_at,'expiresAt',a.expires_at,
  'metadataRetrievedAt',a.metadata_retrieved_at,'dataRetrievedAt',a.data_retrieved_at,
  'metadataVersionId',a.metadata_version_id,'dataVersionId',a.data_version_id)
 into result from terra_private.source_raw_pair_artifacts a
 join terra_private.source_response_pairs p on p.id=a.pair_id
 join terra_private.update_run_manifests f on f.run_id=m.run_id
 where a.pair_id=m.pair_id and a.xmin<>pg_current_xact_id()::xid
  and p.xmin<>pg_current_xact_id()::xid and f.xmin<>pg_current_xact_id()::xid;
 if result is null then raise exception 'Raw pair binding requires prior COMMIT' using errcode='23514'; end if;
 return result;
end;
$raw_read$;

revoke all on all functions in schema terra_ssb_private_capture_api from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_ssb_private_capture_api.read_admitted_context()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $admission_read$
declare m terra_ssb_private_capture_api.principal_scopes%rowtype;
 d terra_ssb_private_capture_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype;
 w terra_private.update_run_work_state%rowtype;
 attempt integer; canonical text; observed timestamptz;
begin
 m:=terra_ssb_private_capture_api.current_scope('metadata');
 d:=terra_ssb_private_capture_api.current_scope('data');
 select * into r from terra_private.update_runs where id=m.run_id;
 select * into w from terra_private.update_run_work_state where run_id=m.run_id;
 perform terra_private.assert_update_run_work(m.run_id,r.request_fingerprint,m.work_claim_id);
 if m.registration_id=d.registration_id or m.source_version_id=d.source_version_id
  or exists(select 1 from terra_private.source_response_reservations where run_id=m.run_id)
  or exists(select 1 from terra_private.source_response_pairs where id=m.pair_id)
  or exists(select 1 from terra_private.source_versions where id in(m.source_version_id,d.source_version_id))
  or exists(select 1 from terra_private.update_run_closeouts where run_id=m.run_id) then
  raise exception 'Private admission requires unstarted fixed response contexts' using errcode='42501';
 end if;
 select canonical_request into canonical from terra_private.update_run_requests where run_id=m.run_id;
 select attempt_no into attempt from terra_private.update_run_work_claims where id=m.work_claim_id;
 observed:=clock_timestamp();
 if canonical is null or clock_timestamp()>=least(w.lease_expires_at,w.deadline_at,m.expires_at,d.expires_at) then
  raise exception 'Private admission is unavailable or expired' using errcode='42501';
 end if;
 return jsonb_build_object('schemaVersion',1,'principal',session_user::text,
  'sourceInventorySha256',m.source_inventory_sha256,'canonicalRequest',canonical,
  'runId',m.run_id,'workClaimId',m.work_claim_id,'pairId',m.pair_id,'workAttempt',attempt,
  'leaseExpiresAt',w.lease_expires_at,'deadlineAt',w.deadline_at,
  'scopeExpiresAt',least(w.lease_expires_at,w.deadline_at,m.expires_at,d.expires_at),'observedAt',observed,
  'responseContexts',jsonb_build_object(
   'metadata',jsonb_build_object('registrationId',m.registration_id,'sourceVersionId',m.source_version_id,
    'requestKey','ssb-14059:private:metadata','maxBodyBytes',m.max_body_bytes,
    'endpointSha256',encode(sha256(convert_to((select exact_endpoint from terra_private.source_registrations where id=m.registration_id),'UTF8')),'hex')),
   'data',jsonb_build_object('registrationId',d.registration_id,'sourceVersionId',d.source_version_id,
    'requestKey','ssb-14059:private:data','maxBodyBytes',d.max_body_bytes,
    'endpointSha256',encode(sha256(convert_to((select exact_endpoint from terra_private.source_registrations where id=d.registration_id),'UTF8')),'hex'))));
end;
$admission_read$;
revoke all on function terra_ssb_private_capture_api.read_admitted_context()
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_ssb_private_capture_api.read_retention_context()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $admission_read$
declare m terra_ssb_private_capture_api.principal_scopes%rowtype;
 d terra_ssb_private_capture_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype;
 w terra_private.update_run_work_state%rowtype;
 attempt integer; canonical text; observed timestamptz;
begin
 m:=terra_ssb_private_capture_api.current_scope('metadata');
 d:=terra_ssb_private_capture_api.current_scope('data');
 select * into r from terra_private.update_runs where id=m.run_id;
 select * into w from terra_private.update_run_work_state where run_id=m.run_id;
 perform terra_private.assert_update_run_work(m.run_id,r.request_fingerprint,m.work_claim_id);
 if m.registration_id=d.registration_id or m.source_version_id=d.source_version_id
  or exists(select 1 from terra_private.source_response_pairs where id=m.pair_id)
  or exists(select 1 from terra_private.source_versions where id in(m.source_version_id,d.source_version_id))
  or exists(select 1 from terra_private.update_run_closeouts where run_id=m.run_id) then
  raise exception 'Private admission requires unstarted fixed response contexts' using errcode='42501';
 end if;
 select canonical_request into canonical from terra_private.update_run_requests where run_id=m.run_id;
 select attempt_no into attempt from terra_private.update_run_work_claims where id=m.work_claim_id;
 observed:=clock_timestamp();
 if canonical is null or clock_timestamp()>=least(w.lease_expires_at,w.deadline_at,m.expires_at,d.expires_at) then
  raise exception 'Private admission is unavailable or expired' using errcode='42501';
 end if;
 return jsonb_build_object('schemaVersion',1,'principal',session_user::text,
  'sourceInventorySha256',m.source_inventory_sha256,'canonicalRequest',canonical,
  'runId',m.run_id,'workClaimId',m.work_claim_id,'pairId',m.pair_id,'workAttempt',attempt,
  'leaseExpiresAt',w.lease_expires_at,'deadlineAt',w.deadline_at,
  'scopeExpiresAt',least(w.lease_expires_at,w.deadline_at,m.expires_at,d.expires_at),'observedAt',observed,
  'responseContexts',jsonb_build_object(
   'metadata',jsonb_build_object('registrationId',m.registration_id,'sourceVersionId',m.source_version_id,
    'requestKey','ssb-14059:private:metadata','maxBodyBytes',m.max_body_bytes,
    'endpointSha256',encode(sha256(convert_to((select exact_endpoint from terra_private.source_registrations where id=m.registration_id),'UTF8')),'hex')),
   'data',jsonb_build_object('registrationId',d.registration_id,'sourceVersionId',d.source_version_id,
    'requestKey','ssb-14059:private:data','maxBodyBytes',d.max_body_bytes,
    'endpointSha256',encode(sha256(convert_to((select exact_endpoint from terra_private.source_registrations where id=d.registration_id),'UTF8')),'hex'))));
end;
$admission_read$;
revoke all on function terra_ssb_private_capture_api.read_retention_context()
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
