-- Isolated experiment only: fresh authority read AFTER the fixed adapter has
-- committed its operation. This adds no DML grant or general SQL permission.
-- A confirmation binds a saved receipt; it is not a fresh dispatch permission.
create function terra_response_test_api.confirm_response(p_phase text,p_receipt text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $confirm$
declare p terra_response_test_api.principal_scopes%rowtype;
 q terra_private.source_response_reservations%rowtype;
 d terra_private.source_response_dispatches%rowtype;
 s terra_private.source_response_settlements%rowtype;
 r terra_private.update_runs%rowtype;w terra_private.update_run_work_state%rowtype;
 incoming jsonb; expected jsonb; observed timestamptz; expires timestamptz;
begin
 p:=terra_response_test_api.current_scope();
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
revoke all on function terra_response_test_api.confirm_response(text,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
