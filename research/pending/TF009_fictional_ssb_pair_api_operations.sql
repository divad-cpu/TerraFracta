-- Isolated, shadow-only paired fixture writer. No arbitrary source, identity,
-- version, pair ID, usable assessment, checkpoint or public claim input.
create function terra_pair_capture_test_api.store_pair(p_metadata_hex text,p_data_hex text,
 p_metadata_time timestamptz,p_data_time timestamptz,p_manifest text)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $store$
declare m terra_pair_capture_test_api.principal_scopes%rowtype;
 d terra_pair_capture_test_api.principal_scopes%rowtype;
 c terra_pair_capture_test_api.principal_scopes%rowtype;
 q terra_private.source_response_reservations%rowtype;
 s terra_private.source_response_settlements%rowtype;
 p terra_private.source_response_pairs%rowtype;
 fingerprint text;body bytea;retrieved timestamptz;hex_body text;
begin
 m:=terra_pair_capture_test_api.current_scope('metadata');
 d:=terra_pair_capture_test_api.current_scope('data');
 if m.run_id is distinct from d.run_id or m.work_claim_id is distinct from d.work_claim_id
  or m.pair_id is distinct from d.pair_id or m.trusted_manifest is distinct from d.trusted_manifest
  or m.registration_id=d.registration_id or m.source_version_id=d.source_version_id
  or p_manifest is distinct from m.trusted_manifest then
  raise exception 'Paired store differs from both trusted contexts' using errcode='42501';
 end if;
 perform terra_private.validate_run_manifest(p_manifest);
 select request_fingerprint into fingerprint from terra_private.update_runs where id=m.run_id;
 perform terra_private.assert_update_run_work(m.run_id,fingerprint,m.work_claim_id);
 if exists(select 1 from terra_private.source_response_pairs where id=m.pair_id) then
  select * into p from terra_private.source_response_pairs where id=m.pair_id;
  if p.registration_id is distinct from d.registration_id or p.metadata_registration_id is distinct from m.registration_id
   or p.metadata_version_id is distinct from m.source_version_id or p.data_version_id is distinct from d.source_version_id
   or p.metadata_retrieved_at is distinct from p_metadata_time or p.data_retrieved_at is distinct from p_data_time
   or not exists(select 1 from terra_private.update_run_manifests where run_id=m.run_id and canonical_manifest=p_manifest)
   or encode(sha256(decode(p_metadata_hex,'hex')),'hex') is distinct from m.body_sha256
   or encode(sha256(decode(p_data_hex,'hex')),'hex') is distinct from d.body_sha256 then
   raise exception 'Paired store replay differs from preserved pair' using errcode='23514';
  end if;
  return jsonb_build_object('stored',true,'status','existing');
 end if;
 for c in select * from terra_pair_capture_test_api.principal_scopes
   where principal=session_user order by response_kind loop
  hex_body:=case when c.response_kind='metadata' then p_metadata_hex else p_data_hex end;
  retrieved:=case when c.response_kind='metadata' then p_metadata_time else p_data_time end;
  if hex_body is null or octet_length(hex_body)<>2*c.body_bytes or hex_body!~'^[0-9a-f]+$'
   or retrieved is null or not isfinite(retrieved) then
   raise exception 'Paired capture body/time is invalid' using errcode='23514';
  end if;
  body:=decode(hex_body,'hex');
  select * into q from terra_private.source_response_reservations
   where run_id=c.run_id and registration_id=c.registration_id;
  select * into s from terra_private.source_response_settlements where reservation_id=q.id;
  if encode(sha256(body),'hex') is distinct from c.body_sha256
   or q.id is null or s.reservation_id is null or s.outcome<>'measured'
   or s.content_sha256 is distinct from c.body_sha256 or s.body_bytes is distinct from c.body_bytes
   or q.work_claim_id is distinct from c.work_claim_id
   or exists(select 1 from terra_private.source_response_settlements where reservation_id=q.id and xmin=pg_current_xact_id()::xid) then
   raise exception 'Paired capture differs from committed measured response' using errcode='23514';
  end if;
  insert into terra_private.source_versions(id,registration_id,item_key,source_url,retrieved_at,content_sha256)
   select c.source_version_id,c.registration_id,'fictional:paired:'||source_key,exact_endpoint,retrieved,c.body_sha256
   from terra_private.source_registrations where id=c.registration_id;
  insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,source_version_id,
   content_sha256,outcome,total_response_bytes,work_claim_id)
   select c.run_id,c.registration_id,source_key,c.source_version_id,c.body_sha256,'captured',s.body_bytes,c.work_claim_id
   from terra_private.source_registrations where id=c.registration_id;
 end loop;
 insert into terra_private.source_response_pairs(id,registration_id,metadata_registration_id,attempt_key,
  metadata_version_id,data_version_id,metadata_retrieved_at,data_retrieved_at)
 values(m.pair_id,d.registration_id,m.registration_id,'fictional:paired:'||m.run_id::text,
  m.source_version_id,d.source_version_id,p_metadata_time,p_data_time);
 insert into terra_private.source_pair_run_bindings(pair_id,run_id,work_claim_id,metadata_source_key,data_source_key)
 values(m.pair_id,m.run_id,m.work_claim_id,'ssb-14059-metadata','ssb-14059-data');
 insert into terra_private.source_pair_validations(pair_id,registration_id,validation_state)
 values(m.pair_id,d.registration_id,'pending');
 insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id)
 values(m.run_id,p_manifest,encode(sha256(convert_to(p_manifest,'UTF8')),'hex'),m.work_claim_id);
 return jsonb_build_object('stored',true,'status','created');
end;
$store$;

create function terra_pair_capture_test_api.read_pair_checkpoint()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $read$
declare m terra_pair_capture_test_api.principal_scopes%rowtype;result jsonb;
begin
 m:=terra_pair_capture_test_api.current_scope('metadata');
 perform terra_pair_capture_test_api.current_scope('data');
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

create function terra_pair_capture_test_api.close_processing()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $close$
declare m terra_pair_capture_test_api.principal_scopes%rowtype;fingerprint text;
begin
 m:=terra_pair_capture_test_api.current_scope('metadata');
 perform terra_pair_capture_test_api.current_scope('data');
 select request_fingerprint into fingerprint from terra_private.update_runs where id=m.run_id;
 perform terra_pair_capture_test_api.read_pair_checkpoint();
 return terra_private.close_update_run_processing(m.run_id,fingerprint,m.work_claim_id,
  encode(sha256(convert_to(m.trusted_manifest,'UTF8')),'hex'));
end;
$close$;

create function terra_pair_capture_test_api.read_closeout()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $close_read$
declare m terra_pair_capture_test_api.principal_scopes%rowtype;result jsonb;
begin
 m:=terra_pair_capture_test_api.current_scope('metadata');
 perform terra_pair_capture_test_api.current_scope('data');
 select jsonb_build_object('schemaVersion',1,'status','existing_closeout','runId',c.run_id,
  'requestFingerprint',r.request_fingerprint,'workClaimId',c.work_claim_id,'manifestSha256',c.manifest_sha256,
  'finishedAt',c.finished_at,'summary',c.summary) into result
 from terra_private.update_run_closeouts c join terra_private.update_runs r on r.id=c.run_id
 where c.run_id=m.run_id and c.work_claim_id=m.work_claim_id and c.xmin<>pg_current_xact_id()::xid;
 if result is null then raise exception 'Paired closeout requires prior COMMIT' using errcode='23514';end if;
 return result;
end;
$close_read$;
