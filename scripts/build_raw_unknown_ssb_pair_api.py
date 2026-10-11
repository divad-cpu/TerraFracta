"""Isolated raw-artifact binding candidate on the unknown first-capture API.

No primary migration, source registration, identity or actual raw-root selector.
Only the trusted custodian supplies the raw folder identity/time after fsync;
the worker channel has no filesystem selector. A database cannot prove bytes
exist, so exact post-COMMIT custody reconciliation is still mandatory.
"""
from scripts.build_unknown_ssb_pair_api import build_unknown_ssb_pair_api
from scripts.build_fictional_ssb_pair_api import once,SCHEMA

READ_RAW=f'''
create function {SCHEMA}.read_raw_pair_binding()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $raw_read$
declare m {SCHEMA}.principal_scopes%rowtype; result jsonb;
begin
 m:={SCHEMA}.current_scope('metadata');
 perform {SCHEMA}.current_scope('data');
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
'''


def build_raw_unknown_ssb_pair_api():
    sql=build_unknown_ssb_pair_api()
    sql=once(sql,' enabled boolean not null default false,',' enabled boolean not null default false,\n retain_raw boolean not null default false,')
    sql=once(sql,' p_metadata_time timestamptz,p_data_time timestamptz,p_manifest text)',
        ' p_metadata_time timestamptz,p_data_time timestamptz,p_manifest text,p_raw_attempt text,p_stored_at timestamptz)')
    sql=once(sql," m:=terra_pair_capture_test_api.current_scope('metadata');\n d:=terra_pair_capture_test_api.current_scope('data');", """ m:=terra_pair_capture_test_api.current_scope('metadata');
 d:=terra_pair_capture_test_api.current_scope('data');
 if not m.retain_raw or not d.retain_raw or p_raw_attempt is null or p_raw_attempt!~'^[0-9a-f]{32}$'
  or p_stored_at is null or not isfinite(p_stored_at) or p_stored_at>clock_timestamp() then
  raise exception 'Trusted private raw custody is required' using errcode='23514';
 end if;""")
    marker="   or not exists(select 1 from terra_private.update_run_manifests where run_id=m.run_id and canonical_manifest=p_manifest)"
    sql=once(sql,marker,marker+"""
   or not exists(select 1 from terra_private.source_raw_pair_artifacts a where a.pair_id=m.pair_id
     and a.raw_attempt_id=p_raw_attempt and a.stored_at=p_stored_at)""")
    marker=" insert into terra_private.source_pair_validations(pair_id,registration_id,validation_state)"
    sql=once(sql,marker,""" insert into terra_private.source_raw_pair_artifacts(pair_id,metadata_retrieved_at,data_retrieved_at,
  raw_attempt_id,metadata_sha256,data_sha256,stored_at,expires_at,metadata_version_id,data_version_id)
 values(m.pair_id,p_metadata_time,p_data_time,p_raw_attempt,
  encode(sha256(decode(p_metadata_hex,'hex')),'hex'),encode(sha256(decode(p_data_hex,'hex')),'hex'),
  p_stored_at,p_metadata_time+interval '720 hours',m.source_version_id,d.source_version_id);
"""+marker)
    marker='revoke all on all functions in schema '+SCHEMA
    sql=once(sql,marker,READ_RAW+'\n'+marker)
    return '-- ISOLATED UNKNOWN-RAW CUSTODY CANDIDATE. No live source or primary changes.\n'+sql
