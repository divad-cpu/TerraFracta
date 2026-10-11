"""Run three whole updates in new named databases on the network-none clone.

No primary writes, real source, application credential or website database
connection. Refuses existing databases/evidence and retains every failure.
"""
from dataclasses import asdict
from datetime import datetime, timezone
from hashlib import sha256
import json
import subprocess
import sys
import time

from scripts.captured_fictional_pipeline import (ROOT,TARGET,PROOF,CASES,BIN,
    OwnerPipelineBackend, private_file)
from workers.captured_update_pipeline import execute_captured_update
from workers.update_run_closeout import completion_summary_payload


def main():
    if sys.argv[1:]: raise RuntimeError('Fixed trial accepts no arguments')
    assert not PROOF.exists(); PROOF.mkdir(mode=0o700,parents=True)
    def admin(sql, name):
        p = subprocess.run(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres',
            '-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True,timeout=15)
        private_file(PROOF/(name+'.log'),p.stdout+'\n'+p.stderr)
        assert p.returncode==0,name
        return p.stdout.strip()
    info = json.loads(subprocess.run(['docker','inspect','--format',
        '{"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"labels":{{json .Config.Labels}}}',TARGET],
        capture_output=True,text=True,check=True,timeout=10).stdout)
    assert info == {'running':False,'network':'none','labels':{'terrafracta.bundle-review':'20261001'}}
    bundle = (ROOT/'research/pending/TF009_local_capture_visibility_bundle.sql').read_bytes()
    assert sha256(bundle).hexdigest()==json.loads((ROOT/'research/pending/TF009_local_capture_visibility_bundle.manifest.json').read_text())['bundleSha256']
    started = False
    try:
        subprocess.run(['docker','start',TARGET],capture_output=True,check=True,timeout=15); started=True
        for _ in range(20):
            p = subprocess.run(['docker','exec',TARGET,BIN+'pg_isready','-h','/tmp','-U','postgres'],capture_output=True,timeout=5)
            if p.returncode==0: break
            time.sleep(.2)
        else: raise RuntimeError('Owned clone did not become ready')
        existing = admin('begin read only;select datname from pg_database;rollback;','existing_databases').splitlines()
        assert not set(CASES.values()).intersection(existing)
        results = []
        for case,db in CASES.items():
            admin('create database '+db+';','new_database_'+case)
            backend = OwnerPipelineBackend(case)
            for i,path in enumerate(sorted((ROOT/'supabase/migrations').glob('*.sql'))):
                backend.query(path.read_text(),'baseline_'+str(i))
            backend.query(bundle.decode(),'exact_owner_bundle')
            assert backend.query('select count(*) from terra_private.update_runs;','empty')=='0'
            plan = backend.seed_and_claim()
            if case=='inconsistent_display':
                try:
                    execute_captured_update((plan,),backend)
                except AssertionError as exc:
                    assert str(exc)=='Strict materializer rejected activation.'
                else: raise AssertionError('Inconsistent display unexpectedly committed')
                denied = json.loads(backend.query("begin read only;select jsonb_build_object('activations',"
                    "(select count(*) from terra_private.machine_publication_activations),'activeHeads',"
                    "(select count(*) from terra_private.issue_heads where current_publication_id is not null),"
                    "'closeouts',(select count(*) from terra_private.update_run_closeouts));rollback;",'denied_atomic_readback'))
                assert denied=={'activations':0,'activeHeads':0,'closeouts':0}
                results.append({'caseKey':case,'deniedBeforeCommit':True,**denied})
                continue
            result = execute_captured_update((plan,),backend)
            expected = {'stored_fact':('partial','committed','pending'),
                'held_finished':('completed','none','not_required'),
                'missing_decision':('partial','none','not_required')}[case]
            assert (result.summary.run_state,result.summary.commit_state,result.summary.visibility_state)==expected
            assert backend.stream_opens==1
            # Independent readback observes the committed immutable closeout.
            saved = json.loads(backend.query('begin read only;select summary from terra_private.update_run_closeouts;rollback;','final_closeout_readback'))
            assert saved==completion_summary_payload(result.summary)
            counts = json.loads(backend.query("begin read only;select jsonb_build_object('runs',(select count(*) from terra_private.update_runs),"
                "'reservations',(select count(*) from terra_private.source_response_reservations),'dispatches',(select count(*) from terra_private.source_response_dispatches),"
                "'settlements',(select count(*) from terra_private.source_response_settlements),'checks',(select count(*) from terra_private.update_run_source_checks),"
                "'manifests',(select count(*) from terra_private.update_run_manifests),'decisions',(select count(*) from terra_private.machine_candidate_decisions),"
                "'activations',(select count(*) from terra_private.machine_publication_activations),'closeouts',(select count(*) from terra_private.update_run_closeouts),"
                "'chargedBytes',terra_private.response_reserved_charge("+"'"+str(backend.work.run_id)+"'"+"));rollback;",'final_counts'))
            assert all(counts[k]==1 for k in ('runs','reservations','dispatches','settlements','checks','manifests','closeouts'))
            assert counts['decisions']==int(case!='missing_decision') and counts['activations']==int(case=='stored_fact')
            assert counts['chargedBytes']==len((ROOT/'fixtures/fictional_structured_source.json').read_bytes())
            entry = {'caseKey':case,'database':db,'runId':str(backend.work.run_id),'finishedAt':result.finished_at.isoformat(),
                'events':backend.events,'streamOpens':backend.stream_opens,'counts':counts,'summary':saved}
            if case=='stored_fact': entry['checkedProjection']=backend.checked_projection
            results.append(entry)
        private_file(PROOF/'PIPELINE_RESULT.json',json.dumps({'evidenceKind':'actual_owner_capture_to_processing',
            'observedAt':datetime.now(timezone.utc).isoformat(),'cases':results,'network':'none',
            'actualSourceFetches':0,'primaryChanged':False,'authenticatedRuntimeAccepted':False,'runtimeVisibilityVerified':False},indent=2)+'\n')
        print('PASS three complete owner-only captured updates and inconsistent-display rollback before COMMIT; separate committed readbacks retained.')
    except BaseException as exc:
        private_file(PROOF/'PIPELINE_FAILURE.json',json.dumps({'exceptionType':type(exc).__name__,
            'primaryChanged':False,'existingHistoryRetained':True})+'\n')
        raise
    finally:
        if started: subprocess.run(['docker','stop','--time','10',TARGET],capture_output=True,check=True,timeout=20)
    return 0

if __name__=='__main__': raise SystemExit(main())
