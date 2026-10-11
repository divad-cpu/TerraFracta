"""One fixed read-only snapshot; no client, credential or target selection.

Only a separately authorized parent audit reader may execute this statement.
Historical admission provides literal UUID identities, never current authority.
The audit bypasses the expired runtime API only in its separately trusted role.
"""
from workers.private_attempt_recovery import historical_admission
from workers.pair_native_sql import _literal


def private_recovery_snapshot_sql(admission_raw):
    parsed,saved=historical_admission(admission_raw);context=parsed.context
    run=_literal(saved['runId']);work=_literal(saved['workClaimId']);pair=_literal(saved['pairId'])
    metadata=_literal(context.metadata_version_id);data=_literal(context.data_version_id)
    return f"""begin isolation level repeatable read read only;
set local timezone='UTC';set local statement_timeout='3s';set local lock_timeout='1s';
select jsonb_build_object('schemaVersion',1,'observedAt',clock_timestamp(),
 'runId',r.id,'workClaimId',{work}::uuid,'pairId',{pair}::uuid,
 'canonicalRequest',q.canonical_request,'codeVersion',r.code_version,'requestFingerprint',r.request_fingerprint,
 'counts',jsonb_build_object(
  'reservations',(select count(*) from terra_private.source_response_reservations where run_id=r.id),
  'dispatches',(select count(*) from terra_private.source_response_dispatches d
   join terra_private.source_response_reservations z on z.id=d.reservation_id where z.run_id=r.id),
  'settlements',(select count(*) from terra_private.source_response_settlements s
   join terra_private.source_response_reservations z on z.id=s.reservation_id where z.run_id=r.id),
  'chargedBytes',terra_private.response_reserved_charge(r.id),
  'versions',(select count(*) from terra_private.source_versions where id in({metadata},{data})),
  'pairs',(select count(*) from terra_private.source_response_pairs where id={pair}),
  'checks',(select count(*) from terra_private.update_run_source_checks where run_id=r.id),
  'manifests',(select count(*) from terra_private.update_run_manifests where run_id=r.id),
  'rawArtifacts',(select count(*) from terra_private.source_raw_pair_artifacts where pair_id={pair}),
  'closeouts',(select count(*) from terra_private.update_run_closeouts where run_id=r.id),
  'checkpoints',(select count(*) from terra_private.source_checkpoints where last_response_pair_id={pair}),
  'usablePairs',(select count(*) from terra_private.source_pair_validations where pair_id={pair} and validation_state='usable'),
  'publications',(select count(*) from terra_private.machine_publication_activations where run_id=r.id)),
 'checkpoint',(select jsonb_build_object('schemaVersion',1,'runId',f.run_id,'workClaimId',f.work_claim_id,
  'canonicalManifest',f.canonical_manifest,'manifestSha256',f.manifest_sha256,'pairId',p.id,
  'validationState',v.validation_state,'metadataVersionId',p.metadata_version_id,'dataVersionId',p.data_version_id)
  from terra_private.update_run_manifests f
  join terra_private.source_pair_run_bindings b on b.run_id=f.run_id and b.work_claim_id=f.work_claim_id
  join terra_private.source_response_pairs p on p.id=b.pair_id
  join terra_private.source_pair_validations v on v.pair_id=p.id
  where f.run_id=r.id and p.id={pair}),
 'rawBinding',(select jsonb_build_object('schemaVersion',1,'pairId',a.pair_id,'rawAttemptId',a.raw_attempt_id,
  'metadataSha256',a.metadata_sha256,'dataSha256',a.data_sha256,'storedAt',a.stored_at,'expiresAt',a.expires_at,
  'metadataRetrievedAt',a.metadata_retrieved_at,'dataRetrievedAt',a.data_retrieved_at,
  'metadataVersionId',a.metadata_version_id,'dataVersionId',a.data_version_id)
  from terra_private.source_raw_pair_artifacts a where a.pair_id={pair}),
 'closeout',(select jsonb_build_object('schemaVersion',1,'status','existing_closeout','runId',c.run_id,
  'requestFingerprint',r.request_fingerprint,'workClaimId',c.work_claim_id,'manifestSha256',c.manifest_sha256,
  'finishedAt',c.finished_at,'summary',c.summary)
  from terra_private.update_run_closeouts c where c.run_id=r.id),
 'sourceVersions',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'registrationId',registration_id,
  'contentSha256',content_sha256) order by id),'[]'::jsonb)
  from terra_private.source_versions where id in({metadata},{data})))
from terra_private.update_runs r join terra_private.update_run_requests q on q.run_id=r.id where r.id={run};
rollback;
"""
