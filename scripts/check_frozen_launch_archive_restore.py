"""Recover every retained file, current pins and a lost-acknowledgment assessment.

Native reads are read-only on a new isolated recovery clone. The local held
assessment uses the existing fictional raw pair; it does not restage, close the
old run, enable a LOGIN, import archived code or contact any source.
"""
from datetime import datetime,timezone
import json
import sys
from scripts import check_closed_worker_archive_restore as restore
from scripts.captured_fictional_pipeline import private_file
from scripts.fictional_trial_guard import fixed_trial_guard
from workers.ssb_14059_private_assessment import build_first_private_ssb_assessment
from workers.ssb_14059_raw_binding_receipt import parse_raw_binding
from workers.ssb_14059_raw_custody import PrivateRawCustody
from workers.ssb_14059_recovery import ExpectedRawPair

CASES={
    '20261002053812_cecc11':(1,2,2,2,1),'20261002054536_0c6956':(0,0,2,2,0),
    '20261002054545_845751':(1,2,2,2,1),'20261002054553_bb7d6f':(0,0,2,2,0),
    '20261002054821_315bc1':(1,2,2,2,1),'20261002065337_6c4e88':(0,0,0,0,0),
    '20261002065421_c1b155':(1,2,2,2,1),'20261002065650_020623':(1,2,2,2,1),
    '20261002072427_5879f4':(1,2,2,2,1),'20261002074814_01b7a7':(1,2,2,2,1),
    '20261002075909_c85b4a':(0,0,0,0,0),'20261002080152_ef3caa':(1,2,2,2,1),
    '20261002080642_19cc44':(1,2,2,2,1),
}
LOST_ACK='20261002054545_845751'


def extra_readback(query):
    native_counts=json.loads(query('terra_raw_pair_native_20261002072246_2dc0a3',
        "select jsonb_build_object('functions',(select count(*) from pg_proc where pronamespace='terra_pair_capture_test_api'::regnamespace),"
        "'migrationRegistryPresent',to_regclass('supabase_migrations.schema_migrations') is not null,"
        "'scopes',(select count(*) from terra_pair_capture_test_api.principal_scopes),"
        "'pairs',(select count(*) from terra_private.source_response_pairs),'versions',(select count(*) from terra_private.source_versions));"))
    assert native_counts=={'functions':18,'migrationRegistryPresent':False,'scopes':0,'pairs':0,'versions':0}
    pins=0
    for suffix in CASES:
        saved=restore.BASE/('authenticated-ssb-pair-'+suffix)/'FROZEN_NATIVE_REQUEST.json'
        if saved.exists():
            expected=json.loads(saved.read_bytes())
            actual=json.loads(query('terra_ssb_pair_'+suffix,
                "select jsonb_build_object('schemaVersion',1,'runId',r.id,'requestFingerprint',r.request_fingerprint,"
                "'codeVersion',r.code_version,'canonicalRequest',q.canonical_request) from terra_private.update_runs r "
                "join terra_private.update_run_requests q on q.run_id=r.id;"))
            assert actual==expected;pins+=1
    raw=query('terra_ssb_pair_'+LOST_ACK,
        "select jsonb_build_object('schemaVersion',1,'pairId',pair_id,'rawAttemptId',raw_attempt_id,"
        "'metadataSha256',metadata_sha256,'dataSha256',data_sha256,'storedAt',stored_at,'expiresAt',expires_at,"
        "'metadataRetrievedAt',metadata_retrieved_at,'dataRetrievedAt',data_retrieved_at,"
        "'metadataVersionId',metadata_version_id,'dataVersionId',data_version_id) from terra_private.source_raw_pair_artifacts;")
    record=json.loads(raw)
    expected=ExpectedRawPair(record['rawAttemptId'],record['metadataSha256'],record['dataSha256'],
        datetime.fromisoformat(record['expiresAt']),datetime.fromisoformat(record['metadataRetrievedAt']),
        datetime.fromisoformat(record['dataRetrievedAt']),datetime.fromisoformat(record['storedAt']))
    versions={'metadata':record['metadataVersionId'],'data':record['dataVersionId']}
    binding=parse_raw_binding(raw.encode(),pair_id=record['pairId'],versions=versions,expected=expected)
    before=query('terra_ssb_pair_'+LOST_ACK,"select count(*) from terra_private.update_run_closeouts;")
    assert before=='0'
    with PrivateRawCustody(restore.BASE/('authenticated-ssb-pair-'+LOST_ACK)/'fixture-raw-store') as custody:
        retained=custody.read(binding.attempt_id)
        assessment=build_first_private_ssb_assessment(retained.metadata_response,retained.data_response,binding,
            pair_id=record['pairId'],versions=versions,now=datetime.now(timezone.utc))
    assert all(x['machineDisposition']=='held' for x in assessment['candidates'])
    private_file(restore.PROOF/'RECOVERED_LOST_ACK_HELD_ASSESSMENT.json',json.dumps(assessment,indent=2)+'\n')
    after=query('terra_ssb_pair_'+LOST_ACK,"select count(*) from terra_private.update_run_closeouts;")
    assert after==before
    databases=int(query('postgres',"select count(*) from pg_database where datname like 'terra_%';"))
    return {'retainedDatabaseHistories':databases,'restoredPinnedNativeCandidate':native_counts,
        'exactNativeAdmissionReadbacks':pins,'lostAcknowledgmentRawBindingMatched':True,
        'lostAcknowledgmentHeldCandidates':2,'lostAcknowledgmentRunCloseoutStillAbsent':True,
        'automaticRestage':False,'rawCopiesCreated':False,'sourceRequests':0,'archivedCodeExecuted':False}


def main():
    if sys.argv[1:]:raise ValueError('Fixed frozen-launch archive recovery accepts no arguments')
    restore.ARCHIVE=restore.BASE/'frozen-launch-database-preservation-20261002'
    restore.PROOF=restore.BASE/'frozen-launch-archive-restore-20261002'
    restore.TARGET='terrafracta_restore_frozen_launch_20261002'
    restore.RECOVERY_LABEL='terrafracta.frozen-launch-recovery=20261002'
    restore.RAW_CASE='20261002080642_19cc44';restore.EXTRA_CASES=CASES
    with fixed_trial_guard():return restore.main(extra_readback=extra_readback,
        evidence_kind='actual_frozen_launch_and_held_assessment_archive_recovery')


if __name__=='__main__':raise SystemExit(main())
