"""Actual recovery after child exits, including current-fence lease takeover.

Three new databases in the fixed network-none clone only. Original failed and
accepted histories remain intact. Never refetch, reset or update a saved plan.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
import subprocess
import sys
import time
from uuid import uuid4

from scripts.captured_fictional_pipeline import TARGET,ROOT,BIN,private_file
from scripts.captured_pipeline_recovery_fixture import RECOVERY_PROOF,RECOVERY_DATABASES,RecoveryFixtureBackend
from scripts.check_run_admission_concurrency import quote
from workers.update_request_identity import canonical_update_request,identify_update_request
from workers.update_run_admission import parse_run_admission
from workers.update_run_work import parse_work_claim
from workers.update_run_completion import parse_canonical_run_manifest
from workers.captured_update_pipeline import resume_manifest_processing


def main():
    if sys.argv[1:]:raise RuntimeError('Fixed recovery trial accepts no arguments')
    assert not RECOVERY_PROOF.exists();RECOVERY_PROOF.mkdir(mode=0o700,parents=True)
    meta=json.loads(subprocess.run(['docker','inspect','--format',
        '{"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"labels":{{json .Config.Labels}}}',TARGET],
        capture_output=True,text=True,check=True,timeout=10).stdout)
    assert meta=={'running':False,'network':'none','labels':{'terrafracta.bundle-review':'20261001'}}
    def admin(sql):
        r=subprocess.run(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d','postgres',
            '-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True,timeout=15)
        assert r.returncode==0
        return r.stdout.strip()
    started=False
    try:
        subprocess.run(['docker','start',TARGET],capture_output=True,check=True,timeout=15);started=True
        for _ in range(20):
            if subprocess.run(['docker','exec',TARGET,BIN+'pg_isready','-h','/tmp','-U','postgres'],capture_output=True,timeout=5).returncode==0:break
            time.sleep(.2)
        else:raise RuntimeError('Owned clone did not become ready')
        assert not set(RECOVERY_DATABASES.values()).intersection(admin('select datname from pg_database;').splitlines())
        results=[]
        for mode,db in RECOVERY_DATABASES.items():
            (RECOVERY_PROOF/mode).mkdir(mode=0o700)
            admin('create database '+db+';')
            setup=RecoveryFixtureBackend(mode)
            for i,path in enumerate(sorted((ROOT/'supabase/migrations').glob('*.sql'))):setup.query(path.read_text(),'baseline_'+str(i))
            setup.query((ROOT/'research/pending/TF009_local_capture_visibility_bundle.sql').read_text(),'owner_bundle')
            child=subprocess.run([sys.executable,'-m','scripts.captured_pipeline_crash_child','--mode',mode],cwd=ROOT,
                capture_output=True,text=True,timeout=30)
            assert child.returncode==(19 if mode=='after_activation' else 17) and child.stdout=='' and child.stderr==''
            backend=RecoveryFixtureBackend(mode)
            handoff=json.loads((backend.proof/'CHILD_HANDOFF.json').read_text())
            request=backend.fixed_request();canonical=canonical_update_request(request)
            assert handoff['canonicalRequest']==canonical
            admission_raw=backend.query('select terra_private.admit_update_run('+quote(request.request_key)+','+quote(canonical)+');','read_existing_admission')
            admission=parse_run_admission(admission_raw.encode(),request);assert admission.status=='existing'
            backend.request=request;backend.payload=handoff['payload']
            checkpoint_raw=backend.query("begin read only;select jsonb_build_object('schemaVersion',1,'runId',run_id,'workClaimId',work_claim_id,"
                "'canonicalManifest',canonical_manifest,'manifestSha256',manifest_sha256) from terra_private.update_run_manifests;rollback;",'original_manifest_readback')
            checkpoint=json.loads(checkpoint_raw);assert checkpoint==handoff['manifestCheckpoint']
            manifest=parse_canonical_run_manifest(checkpoint['canonicalManifest'].encode('ascii'))
            assert manifest.run_id==str(admission.run_id)==handoff['originalRunId']
            assert sha256(checkpoint['canonicalManifest'].encode()).hexdigest()==checkpoint['manifestSha256']
            original=handoff['originalClaim']
            if mode=='expired_takeover':
                print('Waiting for the actual saved worker lease to expire before bounded takeover.',flush=True)
                deadline=time.monotonic()+35
                while backend.query('select clock_timestamp()>=lease_expires_at from terra_private.update_run_work_state;','expiry_'+str(backend.counter))!='t':
                    assert time.monotonic()<deadline
                    time.sleep(.5)
                old_close='select terra_private.close_update_run_processing('+','.join(map(quote,(manifest.run_id,manifest.request_fingerprint,
                    original['leaseId'],checkpoint['manifestSha256'])))+');'
                p=subprocess.run(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'],
                    input=old_close,capture_output=True,text=True,timeout=15)
                assert p.returncode!=0 and 'Work lease is not current' in p.stderr
                private_file(backend.proof/'ORIGINAL_FENCE_DENIED.log',p.stderr)
                work_raw=backend.query('select terra_private.claim_update_run_work('+','.join(map(quote,
                    (manifest.run_id,manifest.request_fingerprint,str(uuid4()))))+');','takeover_claim')
            else:
                work_raw=json.dumps(original)
            work=parse_work_claim(work_raw.encode(),request,admission,datetime.now(timezone.utc))
            assert work.deadline_at.isoformat()==datetime.fromisoformat(original['deadlineAt']).isoformat()
            assert work.attempt==(2 if mode=='expired_takeover' else 1)
            backend.work=work;backend.work_payload=json.loads(work_raw)
            result=resume_manifest_processing(manifest,request,work,checkpoint_raw.encode(),checkpoint['workClaimId'],backend)
            assert (result.summary.run_state,result.summary.commit_state,result.summary.visibility_state)==('partial','committed','pending')
            unchanged=json.loads(backend.query('begin read only;select jsonb_build_object(\'canonicalManifest\',canonical_manifest,\'manifestSha256\',manifest_sha256,\'workClaimId\',work_claim_id) from terra_private.update_run_manifests;rollback;','manifest_preserved'))
            assert all(unchanged[k]==checkpoint[k] for k in unchanged)
            counts=json.loads(backend.query("begin read only;select jsonb_build_object('reservations',(select count(*) from terra_private.source_response_reservations),"
                "'dispatches',(select count(*) from terra_private.source_response_dispatches),'settlements',(select count(*) from terra_private.source_response_settlements),"
                "'checks',(select count(*) from terra_private.update_run_source_checks),'decisions',(select count(*) from terra_private.machine_candidate_decisions),"
                "'activations',(select count(*) from terra_private.machine_publication_activations),'closeouts',(select count(*) from terra_private.update_run_closeouts),"
                "'claims',(select count(*) from terra_private.update_run_work_claims));rollback;",'recovery_counts'))
            assert all(v==1 for k,v in counts.items() if k!='claims') and counts['claims']==work.attempt
            assert backend.stream_opens==0
            results.append({'case':mode,'actualChildExit':child.returncode,'counts':counts,'recoveryFixtureReads':0,
                'originalManifestPreserved':True,'originalDeadlinePreserved':True,'newFence':mode=='expired_takeover',
                'runState':result.summary.run_state,'visibilityState':result.summary.visibility_state})
        private_file(RECOVERY_PROOF/'RECOVERY_RESULT.json',json.dumps({'evidenceKind':'actual_captured_pipeline_process_recovery',
            'observedAt':datetime.now(timezone.utc).isoformat(),'cases':results,'network':'none','actualSourceFetches':0,
            'primaryChanged':False,'authenticatedRuntimeAccepted':False,'runtimeVisibilityVerified':False},indent=2)+'\n')
        print('PASS actual child exits after manifest/activation and actual lease takeover: original plan/deadline retained, one activation, no new fixture read.')
    except BaseException as exc:
        private_file(RECOVERY_PROOF/'RECOVERY_FAILURE.json',json.dumps({'exceptionType':type(exc).__name__,'primaryChanged':False,'historyRetained':True})+'\n');raise
    finally:
        if started:subprocess.run(['docker','stop','--time','10',TARGET],capture_output=True,check=True,timeout=20)
    return 0

if __name__=='__main__':raise SystemExit(main())
