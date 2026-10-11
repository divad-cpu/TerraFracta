"""Pending-only private SSB API candidate, outside active migrations.

Reuse the reviewed pinned unknown/raw API with a distinct fixed namespace and
private request/item keys. This creates no account, target, source approval or
publication route. The added no-argument reader checks native scope/work and
absence of previous response events before returning a bounded admission view.
"""
from scripts.build_pinned_raw_ssb_pair_api import build_pinned_raw_ssb_pair_api
from scripts.build_fictional_ssb_pair_api import SCHEMA, once
from workers.ssb_14059_capture import METADATA_URL, DATA_URL

PRIVATE_SCHEMA = 'terra_ssb_private_capture_api'
REQUEST_PREFIX = 'ssb-14059:private:'

# Source rights and the scoped account's permission are independent. Hold both
# source rows in fixed order until this native transaction completes, so a
# concurrent withdrawal cannot pass the last scope/COMMIT check unnoticed.
SOURCE_RETENTION_GUARD = f'''
 perform 1 from terra_private.source_registrations registration
  join {PRIVATE_SCHEMA}.principal_scopes peer on peer.registration_id=registration.id
  where peer.principal=session_user order by registration.id for share of registration;
 if exists(select 1 from {PRIVATE_SCHEMA}.principal_scopes peer
  left join terra_private.source_registrations registration on registration.id=peer.registration_id
  where peer.principal=session_user and (registration.id is null
   or registration.registration_state<>'approved' or not registration.allow_fetch
   or not registration.fetch_enabled or not registration.allow_retain
   or registration.reviewed_at is null or not isfinite(registration.reviewed_at)
   or registration.reviewed_at>clock_timestamp()
   or registration.allow_public_derived
   or registration.source_key is distinct from ('ssb-14059-'||peer.response_kind)
   or registration.exact_endpoint is distinct from (case when peer.response_kind='metadata'
    then '{METADATA_URL}' else '{DATA_URL}' end))) then
  raise exception 'Current paired source retention rights are unavailable' using errcode='42501';
 end if;
'''

ADMISSION_READER = f'''
create function {PRIVATE_SCHEMA}.read_admitted_context()
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,pg_temp as $admission_read$
declare m {PRIVATE_SCHEMA}.principal_scopes%rowtype;
 d {PRIVATE_SCHEMA}.principal_scopes%rowtype;
 r terra_private.update_runs%rowtype;
 w terra_private.update_run_work_state%rowtype;
 attempt integer; canonical text; observed timestamptz;
begin
 m:={PRIVATE_SCHEMA}.current_scope('metadata');
 d:={PRIVATE_SCHEMA}.current_scope('data');
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
    'requestKey','{REQUEST_PREFIX}metadata','maxBodyBytes',m.max_body_bytes,
    'endpointSha256',encode(sha256(convert_to((select exact_endpoint from terra_private.source_registrations where id=m.registration_id),'UTF8')),'hex')),
   'data',jsonb_build_object('registrationId',d.registration_id,'sourceVersionId',d.source_version_id,
    'requestKey','{REQUEST_PREFIX}data','maxBodyBytes',d.max_body_bytes,
    'endpointSha256',encode(sha256(convert_to((select exact_endpoint from terra_private.source_registrations where id=d.registration_id),'UTF8')),'hex'))));
end;
$admission_read$;
revoke all on function {PRIVATE_SCHEMA}.read_admitted_context()
 from public,anon,authenticated,service_role,terra_collector,terra_operator,terra_reviewer,terra_issue_reader;
'''


def build_private_ssb_capture_api():
    sql = build_pinned_raw_ssb_pair_api()
    if SCHEMA not in sql:
        raise ValueError('Private capture API template changed')
    sql = sql.replace(SCHEMA, PRIVATE_SCHEMA)
    marker = ' select * into r from terra_private.update_runs where id=p.run_id;\n select * into s from terra_private.source_registrations where id=p.registration_id;'
    sql = once(sql, marker, SOURCE_RETENTION_GUARD + marker)
    sql = once(sql, "p_key:='fictional:ssb:'||p_kind", f"p_key:='{REQUEST_PREFIX}'||p_kind")
    if "'fictional:paired:'" not in sql:
        raise ValueError('Private pair identity template changed')
    sql = sql.replace("'fictional:paired:'", "'ssb-14059:private-pair:'")
    # Pre-save read permits the already dispatched responses, but still refuses
    # an existing pair/version/closeout. It reuses the exact admission shape and
    # current rights; it supplies no new worker operation or editable grant.
    retention = ADMISSION_READER.replace('read_admitted_context()', 'read_retention_context()')
    retention = once(retention,
        '  or exists(select 1 from terra_private.source_response_reservations where run_id=m.run_id)\n', '')
    return '-- PRIVATE SSB CAPTURE API V2 CANDIDATE. No active migration or live grant.\n' + sql + ADMISSION_READER + retention
