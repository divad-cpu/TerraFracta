"""Actual isolated unknown-hash pair plus fsynced private fixture raw custody.

Worker has no raw path, folder ID, database credential or SQL selector. Only
parent custody binds local exact bytes and reopens its committed native receipt.
No selected live raw root, real source, primary or public writer is touched.
"""
from datetime import datetime,timezone
from hashlib import sha256
import json
import sys
from scripts.captured_fictional_pipeline import private_file
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_ssb_pair_capture import _run_trial
from scripts.run_closed_pair_channel_trial import run_worker
from workers.closed_pair_channel import _binary
from workers.ssb_14059_capture import CapturedResponse,METADATA_URL,DATA_URL
from workers.ssb_14059_raw_custody import PrivateRawCustody
from workers.ssb_14059_raw_store import DEFAULT_ROOT
from workers.ssb_14059_recovery import ExpectedRawPair,reconcile_private_ssb_14059_pairs
from workers.ssb_14059_raw_binding_receipt import parse_raw_binding


def runtime_with_raw(requests,versions,pair_id,principal,client,proof,canonical,reads,*,fault=None,transport_children=False,transport_fault=None,frozen_source=None,private_collector_source=None):
    raw_root=proof/'fixture-raw-store'
    assert raw_root!=DEFAULT_ROOT and not raw_root.exists()
    observed={}
    with PrivateRawCustody(raw_root) as custody:
        def intercept(operation,arguments,sql,native):
            if operation!='store_pair':return native(sql)
            if observed:raise ValueError('Private raw pair was already staged; no automatic restage')
            captures=[]
            for kind,url in (('metadata',METADATA_URL),('data',DATA_URL)):
                captures.append(CapturedResponse(url,url,0,200,'application/json',_binary(arguments[kind],65536),
                    datetime.fromisoformat(arguments[kind+'RetrievedAt'])))
            stored_at=datetime.now(timezone.utc)
            saved=custody.store(*captures,now=stored_at)
            reread=custody.read(saved.attempt_id)
            assert (reread.metadata_response,reread.data_response)==tuple(captures)
            expected=ExpectedRawPair(saved.attempt_id,sha256(captures[0].body).hexdigest(),sha256(captures[1].body).hexdigest(),
                saved.expires_at,captures[0].retrieved_at,captures[1].retrieved_at,stored_at)
            observed.update(expected=expected,saved=saved)
            extension=quote(saved.attempt_id)+','+quote(stored_at.isoformat())
            if not sql.endswith(');'):raise ValueError('Fixed native raw store statement changed')
            raw_sql=sql[:-2]+','+extension+');'
            if fault=='database_rejected_after_raw':
                raw_sql=raw_sql.replace(quote(saved.attempt_id),quote('invalid-fixture-folder'),1)
            if fault=='raw_binding_read_before_commit':
                raw_sql='begin;'+raw_sql+'select terra_pair_capture_test_api.read_raw_pair_binding();commit;'
            result=native(raw_sql)
            if result.returncode:return result
            private_file(proof/'RAW_STORE_COMMIT.json',result.stdout)
            if fault=='raw_store_reply_lost':raise ValueError('Synthetic raw store reply loss after actual COMMIT')
            reopened=native('select terra_pair_capture_test_api.read_raw_pair_binding();')
            if reopened.returncode:raise ValueError('Private raw artifact readback refused')
            binding=parse_raw_binding(reopened.stdout.strip().encode(),pair_id=pair_id,versions=versions,expected=expected)
            findings=reconcile_private_ssb_14059_pairs([binding],root=raw_root)
            if len(findings)!=1 or findings[0].state!='matched' or findings[0].issues:
                raise ValueError('Private raw/database custody disagrees')
            private_file(proof/'RAW_POST_COMMIT_BINDING.json',reopened.stdout)
            private_file(proof/'RAW_CUSTODY_RECONCILIATION.json',json.dumps({'state':'matched','coordinatedPrivateRoot':True,
                'exactHashesAndTimesMatch':True,'sourceRequests':0,'liveRawRootTouched':False,'physicalExpiryGuaranteed':False})+'\n')
            from workers.ssb_14059_private_assessment import build_first_private_ssb_assessment
            assessment=build_first_private_ssb_assessment(reread.metadata_response,reread.data_response,binding,
                pair_id=pair_id,versions=versions,now=datetime.now(timezone.utc))
            private_file(proof/'PRIVATE_SSB_ASSESSMENT.json',json.dumps(assessment,indent=2)+'\n')
            return result
        try:
            result=run_worker(requests,versions,pair_id,principal,client,proof,canonical,reads,operation_interceptor=intercept,transport_children=transport_children,transport_fault=transport_fault,frozen_source=frozen_source,private_collector_source=private_collector_source)
        finally:
            if observed:
                inventory=custody.inventory()
                private_file(proof/'RAW_TERMINAL_INVENTORY.json',json.dumps({'count':len(inventory),'attemptId':observed['saved'].attempt_id,
                    'expiresAt':observed['expected'].expires_at.isoformat(),'filesPresent':inventory[0].present_files,
                    'rawBytesRetainedForRecovery':True,'liveRawRootTouched':False},indent=2)+'\n')
    return result


def main():
    if sys.argv[1:]:raise ValueError('Fixed raw fixture trial accepts no arguments')
    with fixed_trial_guard():result=_run_trial('nominal',runtime_runner=runtime_with_raw,unknown_response_mode=True,raw_custody_mode=True)
    print(json.dumps(result,indent=2));return 0

if __name__=='__main__':raise SystemExit(main())
