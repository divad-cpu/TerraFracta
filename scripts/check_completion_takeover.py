"""One-shot real lease-expiry takeover of a fixed captured fictional plan.

Fixed corrected test volume only. Reuses unchanged content and preserves both
claims, the original manifest and the resulting held closeout. No fetch,
activation, primary mutation, reset or caller-selected target.
"""

from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time

from scripts.check_final_completion_commit import ARGS, CONTAINER, NETWORK, STATE
from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.check_run_admission_draft import query as owner_query
from scripts.fictional_run_admission_cases import fictional_request
from scripts.fictional_run_completion import fictional_completion_manifest
from workers.update_request_identity import canonical_update_request, identify_update_request
from workers.update_run_admission import parse_run_admission
from workers.update_run_work import parse_work_claim
from workers.update_run_completion import DecisionReceipt,canonical_run_manifest,reconcile_run_completion
from workers.update_run_closeout import parse_run_closeout


def query(sql): return owner_query(CONTAINER,sql)


def denied(sql):
    result=subprocess.run(ARGS,input=sql,text=True,capture_output=True,timeout=15)
    assert result.returncode!=0 and 'Work lease is not current' in result.stderr


def main():
    if sys.argv[1:]: raise RuntimeError('Fixed takeover case accepts no arguments')
    meta=json.loads(subprocess.run(['docker','inspect','--format',
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',CONTAINER],
        text=True,capture_output=True,check=True,timeout=10).stdout)
    assert meta['ports']['5432/tcp']==[{'HostIp':'127.0.0.1','HostPort':'64832'}]
    assert set(meta['networks'])=={NETWORK}
    assert json.loads(query(STATE))=={'migrations':30,'runs':3,'versions':1,'checks':3,'manifests':2,'activations':1,'closeouts':2,'heads':1}
    evidence=Path('/tmp/terrafracta-completion-takeover-20260930.json'); assert not evidence.exists()
    request=replace(fictional_request(),request_key='fictional:completion:takeover-manifest',
                    scope='fictional-activation-country',mode='publish_eligible')
    fingerprint=identify_update_request(request).request_fingerprint
    admission_raw=query('select terra_private.admit_update_run('+quote(request.request_key)+','+quote(canonical_update_request(request))+');')
    admission=parse_run_admission(admission_raw.encode(),request)
    run_id=str(admission.run_id)
    def claim():
        raw=query('select terra_private.claim_update_run_work('+quote(run_id)+','+quote(fingerprint)+',gen_random_uuid());')
        return parse_work_claim(raw.encode(),request,admission,now=datetime.now(timezone.utc))
    original=claim(); assert original.status=='claimed' and original.attempt==1
    plan=replace(fictional_completion_manifest(),run_id=run_id,request_fingerprint=fingerprint)
    source=plan.sources[0]; canonical=canonical_run_manifest(plan)
    session=Session(ARGS)
    try:
        capture='insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,source_version_id,content_sha256,outcome,total_response_bytes,work_claim_id) values('+','.join((quote(run_id),quote(source.registration_id),quote(source.source_key),quote(source.source_version_id),quote(source.content_sha256),"'unchanged'",'512',quote(str(original.lease_id))))+');'
        manifest='insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id) values('+','.join((quote(run_id),quote(canonical),"encode(sha256(convert_to("+quote(canonical)+",'UTF8')),'hex')",quote(str(original.lease_id))))+');'
        session.execute('begin;'+capture+manifest+'commit;','PLANCOMMITTED')
        identity=json.loads(query('select jsonb_build_object(\'hash\',manifest_sha256,\'claim\',work_claim_id,\'capturedAt\',captured_at) from terra_private.update_run_manifests where run_id='+quote(run_id)+';'))
        def close(lease):
            return 'select terra_private.close_update_run_processing('+','.join(map(quote,(run_id,fingerprint,str(lease),identity['hash'])))+');'
        print('Captured original plan; waiting for actual 30-second work lease expiry.',flush=True)
        wait_limit=time.monotonic()+35
        while query('select clock_timestamp()>=lease_expires_at from terra_private.update_run_work_state where run_id='+quote(run_id)+';')!='t':
            assert time.monotonic()<wait_limit,'Actual lease did not expire within its bound'
            time.sleep(0.25)
        denied(close(original.lease_id))
        successor=claim()
        assert successor.status=='claimed' and successor.attempt==2 and successor.lease_id!=original.lease_id
        assert successor.deadline_at==original.deadline_at
        denied(close(original.lease_id))
        session.execute("insert into terra_private.machine_candidate_decisions(run_id,qualification_id,source_version_id,candidate_key,disposition,content_sha256,evidence_locator,check_trace,reason_codes,machine_actor,decided_at,semantic_contract_sha256,public_citation_url) select "+quote(run_id)+",qualification_id,source_version_id,candidate_key,'held',content_sha256,evidence_locator,check_trace,array['fictional-takeover-resolved-hold'],machine_actor,clock_timestamp(),semantic_contract_sha256,public_citation_url from terra_private.machine_candidate_decisions where id='88888888-8888-4888-8888-888888888888';",'HELDRECORDED')
        decision_id=query('select id from terra_private.machine_candidate_decisions where run_id='+quote(run_id)+';')
        started=datetime.fromisoformat(query('select started_at from terra_private.update_run_work_state where run_id='+quote(run_id)+';'))
        trusted=reconcile_run_completion(plan,(DecisionReceipt(decision_id,plan.items[0].item_key,plan.items[0].source_version_id,'held'),),(),(),now=datetime.now(timezone.utc))
        raw=query(close(successor.lease_id))
        receipt=parse_run_closeout(raw.encode(),plan,str(successor.lease_id),trusted,started_at=started,now=datetime.now(timezone.utc))
        assert receipt.summary.run_state=='completed' and receipt.summary.commit_state=='none'
        assert identity==json.loads(query('select jsonb_build_object(\'hash\',manifest_sha256,\'claim\',work_claim_id,\'capturedAt\',captured_at) from terra_private.update_run_manifests where run_id='+quote(run_id)+';'))
        assert query('select count(*) from terra_private.update_run_work_claims where run_id='+quote(run_id)+';')=='2'
        after=json.loads(query(STATE))
        assert after=={'migrations':30,'runs':4,'versions':1,'checks':4,'manifests':3,'activations':1,'closeouts':3,'heads':1}
        with evidence.open('x') as handle:
            evidence.chmod(0o600)
            json.dump({'evidenceKind':'fictional_captured_plan_takeover','actualLeaseExpiry':True,
                       'originalFenceRefusals':2,'originalDeadlinePreserved':True,'originalManifestPreserved':True,
                       'storedClaims':2,'finalRunState':receipt.summary.run_state,'finalState':after,
                       'actualSourceFetches':0,'newActivations':0},handle,indent=2)
        print('PASS actual expiry and two old-fence refusals; new attempt resolves the original captured plan.')
        print('PASS original manifest/deadline preserved, two claims retained, no duplicate content or activation.')
    finally:
        session.close()
    return 0


if __name__=='__main__': raise SystemExit(main())
