-- Fictional isolated identity experiment only. Not a primary/runtime proposal.
-- A real SCRAM login is mapped by SESSION_USER to one fictional run/source.
-- No client-supplied actor, run, role, registration, endpoint or policy input.
-- Execute under one owner transaction; PUBLIC revocation precedes any grant.

create schema terra_response_test_api;
revoke all on schema terra_response_test_api from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
create table terra_response_test_api.principal_scopes (
 principal name primary key,
 run_id uuid not null references terra_private.update_runs(id),
 registration_id uuid not null references terra_private.source_registrations(id),
 actor_id text not null check(actor_id='runner:fictional'),
 scope text not null check(scope='fictional-country'),
 max_body_bytes integer not null check(max_body_bytes between 1 and 100),
 expires_at timestamptz not null check(isfinite(expires_at)),
 enabled boolean not null default false
);
alter table terra_response_test_api.principal_scopes enable row level security;
revoke all on terra_response_test_api.principal_scopes from public,anon,authenticated,service_role,
 terra_collector,terra_operator,terra_reviewer,terra_issue_reader;

create function terra_response_test_api.current_scope()
returns terra_response_test_api.principal_scopes language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $scope$
declare p terra_response_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; s terra_private.source_registrations%rowtype;
begin
 -- Trust/peer connections cannot be relabelled as authenticated SCRAM calls.
 if system_user is distinct from 'scram-sha-256:'||session_user::text then
  raise exception 'Authenticated fictional response identity required' using errcode='42501';
 end if;
 select * into p from terra_response_test_api.principal_scopes where principal=session_user for share;
 if p.principal is null or not p.enabled or clock_timestamp()>=p.expires_at then
  raise exception 'Fictional response principal has no active scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into s from terra_private.source_registrations where id=p.registration_id;
 if r.requested_by is distinct from p.actor_id or r.jurisdiction_id is distinct from p.scope
  or r.mode<>'shadow' or s.source_key is distinct from 'fictional-response'
  or s.exact_endpoint is distinct from 'https://example.org/fictional-response' then
  raise exception 'Fictional response scope does not match trusted run/source' using errcode='42501';
 end if;
 return p;
end;
$scope$;

create function terra_response_test_api.reserve_response(p_key text,p_max_body integer)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $reserve$
declare p terra_response_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
begin
 p:=terra_response_test_api.current_scope();
 if p_max_body is null or p_max_body<1 or p_max_body>p.max_body_bytes then
  raise exception 'Fictional response bound exceeds principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 return terra_private.reserve_source_response(p.run_id,r.request_fingerprint,w.claim_id,p.registration_id,p_key,p_max_body);
end;
$reserve$;

create function terra_response_test_api.dispatch_response(p_reservation uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $dispatch$
declare p terra_response_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 q terra_private.source_response_reservations%rowtype;
begin
 p:=terra_response_test_api.current_scope();
 select * into q from terra_private.source_response_reservations where id=p_reservation;
 if q.id is null or q.run_id is distinct from p.run_id or q.registration_id is distinct from p.registration_id then
  raise exception 'Fictional response reservation is outside principal scope' using errcode='42501';
 end if;
 select * into r from terra_private.update_runs where id=p.run_id;
 select * into w from terra_private.update_run_work_state where run_id=p.run_id;
 return terra_private.dispatch_source_response(p.run_id,r.request_fingerprint,w.claim_id,p_reservation);
end;
$dispatch$;

create function terra_response_test_api.settle_response(p_reservation uuid,p_outcome text,p_body_bytes integer,p_hash text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $settle$
declare p terra_response_test_api.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype; w terra_private.update_run_work_state%rowtype;
 q terra_private.source_response_reservations%rowtype;
begin
 p:=terra_response_test_api.current_scope();
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

revoke all on function terra_response_test_api.current_scope(),
 terra_response_test_api.reserve_response(text,integer),terra_response_test_api.dispatch_response(uuid),
 terra_response_test_api.settle_response(uuid,text,integer,text)
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
-- Test-specific LOGIN creation, scope seeding and three exact grants are supplied
-- by a fixed acceptance harness, with ephemeral passwords never written/logged.
