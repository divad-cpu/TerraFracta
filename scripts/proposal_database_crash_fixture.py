"""Crash/restart only the caller's new, immutable-ID fictional trial server.

No primary or historical retained container is selected. The restart-capable
launch is constructed by the fixed parent before first start. No restore/reset,
volume removal, account grant or system setting is performed here.
"""
import json,re,subprocess,time
from pathlib import Path
from scripts.check_archived_completion_restore import IMAGE,BIN
from scripts.captured_fictional_pipeline import private_file

def crash_and_restore(identity,proof,phase):
    assert phase in ('captured','completed')
    assert type(identity) is dict and re.fullmatch('[0-9a-f]{64}',identity['containerId'])
    assert re.fullmatch(r'\d{14}_[0-9a-f]{6}',identity['label'])
    assert identity['target']=='terrafracta_operator_proposal_'+identity['label']
    assert identity['volume']==identity['target']+'_data'
    proof=Path(proof);assert proof.is_dir() and proof.stat().st_mode&0o077==0
    parent=proof.parents[1]
    assert json.loads((parent/'OWNED_IDENTITY.json').read_text())==identity
    container=identity['containerId']
    def run(args,timeout=15):return subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    def metadata():
        result=run(['docker','inspect',container]);assert result.returncode==0
        value=json.loads(result.stdout)[0]
        assert value['Id']==container and value['Image']==IMAGE and value['Name']=='/'+identity['target']
        assert value['Config']['Labels']=={'terrafracta.operator-proposal':identity['label']}
        assert value['HostConfig']['NetworkMode']=='none' and value['HostConfig']['ReadonlyRootfs'] is True
        assert not value['HostConfig']['PortBindings'] and value['HostConfig']['RestartPolicy']['Name']=='no'
        mounts=value['Mounts'];assert len(mounts)==1 and mounts[0]['Name']==identity['volume'] and mounts[0]['Destination']=='/trial'
        assert mounts[0]['Type']=='volume' and mounts[0]['RW'] is True
        return value
    before=metadata();assert before['State']['Running'] is True
    killed=run(['docker','kill','--signal','KILL',container]);assert killed.returncode==0
    stopped=metadata();assert stopped['State']['Running'] is False and stopped['State']['ExitCode']==137
    started=run(['docker','start',container]);assert started.returncode==0
    for _ in range(60):
        if run(['docker','exec',container,BIN+'pg_isready','-h','/tmp','-U','postgres'],timeout=5).returncode==0:break
        time.sleep(.1)
    else:raise AssertionError('Owned crash recovery did not become ready')
    after=metadata();assert after['State']['Running'] is True
    assert after['State']['StartedAt']!=before['State']['StartedAt']
    logs=run(['docker','logs','--since',after['State']['StartedAt'],'--tail','80',container]);assert logs.returncode==0
    raw=logs.stdout+'\n'+logs.stderr;assert len(raw.encode())<=131072
    private_file(proof/('database-'+phase+'-crash.log'),raw)
    # The owned image uses locale C; require actual crash recovery, not merely a
    # clean new startup. Original data volume remains attached to the same ID.
    assert 'database system was interrupted' in raw and 'automatic recovery in progress' in raw
    result={'phase':phase,'containerId':container,'volume':identity['volume'],'exitCode':137,
      'startedBefore':before['State']['StartedAt'],'startedAfter':after['State']['StartedAt'],
      'actualCrashRecoveryObserved':True,'newClusterInitialized':False,'network':'none','primaryChanged':False}
    private_file(proof/('database-'+phase+'-crash.json'),json.dumps(result,indent=2)+'\n')
    return result
