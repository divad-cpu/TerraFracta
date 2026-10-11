-- ISOLATED first-capture candidate: response hashes are not preprovisioned.
-- Committed measured receipts bind unknown bounded bytes to fixed contexts.
-- No source fetch, usable assessment, checkpoint or publication authority.
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
 expected jsonb; sources jsonb; supplied jsonb;
begin
 m:=terra_pair_capture_test_api.current_scope('metadata');
 d:=terra_pair_capture_test_api.current_scope('data');
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
 into sources from terra_pair_capture_test_api.principal_scopes authority_row
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
   or encode(sha256(decode(p_metadata_hex,'hex')),'hex') is distinct from
      (select content_sha256 from terra_private.source_versions where id=m.source_version_id)
   or encode(sha256(decode(p_data_hex,'hex')),'hex') is distinct from
      (select content_sha256 from terra_private.source_versions where id=d.source_version_id) then
   raise exception 'Paired store replay differs from preserved pair' using errcode='23514';
  end if;
  return jsonb_build_object('stored',true,'status','existing');
 end if;
 for c in select * from terra_pair_capture_test_api.principal_scopes
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
   select c.source_version_id,c.registration_id,'fictional:paired:'||source_key,exact_endpoint,retrieved,s.content_sha256
   from terra_private.source_registrations where id=c.registration_id;
  insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,source_version_id,
   content_sha256,outcome,total_response_bytes,work_claim_id)
   select c.run_id,c.registration_id,source_key,c.source_version_id,s.content_sha256,'captured',s.body_bytes,c.work_claim_id
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
  (select manifest_sha256 from terra_private.update_run_manifests where run_id=m.run_id));
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
