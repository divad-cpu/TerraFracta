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
