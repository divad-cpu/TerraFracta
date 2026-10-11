-- Additive isolated identity experiment only, not the owner-only primary draft.
-- Deferred triggers execute after the caller has left the definer wrapper.
-- Keep original invoker BEFORE checks. Replace only the three deferred bindings
-- with closed definer copies that validate authenticated scope again at COMMIT.
-- No table grant, general invoker grant, deadline bypass or source activation.

create function terra_response_test_api.validate_commit_scope(p_run uuid,p_registration uuid,p_max_body integer)
returns void language plpgsql volatile security invoker
set search_path=pg_catalog,pg_temp as $scope$
declare p terra_response_test_api.principal_scopes%rowtype;
begin
 -- Isolated owner fixtures retain their existing direct owner route.
 if session_user in ('postgres','supabase_admin') then return; end if;
 p:=terra_response_test_api.current_scope();
 if p.run_id is distinct from p_run or p.registration_id is distinct from p_registration
  or p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then
  raise exception 'Fictional response commit is outside principal scope' using errcode='42501';
 end if;
end;
$scope$;

create function terra_response_test_api.check_reservation_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare r terra_private.update_runs%rowtype; c terra_private.update_run_work_claims%rowtype;
 count_source integer; count_run integer;
begin
 perform terra_response_test_api.validate_commit_scope(new.run_id,new.registration_id,new.max_body_bytes);
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
 deferrable initially deferred for each row execute function terra_response_test_api.check_reservation_commit();

create function terra_response_test_api.check_dispatch_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 perform terra_response_test_api.validate_commit_scope(q.run_id,q.registration_id,q.max_body_bytes);
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
 deferrable initially deferred for each row execute function terra_response_test_api.check_dispatch_commit();

create function terra_response_test_api.check_settlement_commit()
returns trigger language plpgsql security definer
set search_path=pg_catalog,pg_temp as $guard$
declare q terra_private.source_response_reservations%rowtype;
 d terra_private.source_response_dispatches%rowtype; fingerprint text;
begin
 select * into q from terra_private.source_response_reservations where id=new.reservation_id;
 perform terra_response_test_api.validate_commit_scope(q.run_id,q.registration_id,q.max_body_bytes);
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
 deferrable initially deferred for each row execute function terra_response_test_api.check_settlement_commit();

revoke all on function terra_response_test_api.validate_commit_scope(uuid,uuid,integer),
 terra_response_test_api.check_reservation_commit(),terra_response_test_api.check_dispatch_commit(),
 terra_response_test_api.check_settlement_commit()
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
