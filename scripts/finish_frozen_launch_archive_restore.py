"""Read-only continuation on the exact already restored and stopped clone.

The first restore verified all physical bytes and twenty-one case counts but
its extra probe incorrectly assumed a CLI migration registry in a fresh SQL
test database. Retain that failure, finish only missing reads, and do not make
another physical copy or execute archived code.
"""
from datetime import datetime,timezone
import json
import subprocess
import sys
from scripts import check_closed_worker_archive_restore as restore
from scripts.check_frozen_launch_archive_restore import extra_readback
from scripts.check_archived_completion_restore import IMAGE,BIN
from scripts.captured_fictional_pipeline import private_file
from scripts.preserve_connected_trial_databases import digest_file
from scripts.fictional_trial_guard import fixed_trial_guard

TARGET='terrafracta_restore_frozen_launch_20261002'
ARCHIVE=restore.BASE/'frozen-launch-database-preservation-20261002'
FIRST=restore.BASE/'frozen-launch-archive-restore-20261002'
PROOF=restore.BASE/'frozen-launch-archive-restore-finish-20261002'


def main():
    if sys.argv[1:]:raise ValueError('Fixed recovery continuation accepts no arguments')
    assert not PROOF.exists();PROOF.mkdir(mode=0o700);restore.PROOF=PROOF;counter=0;started=False
    def run(args,*,data=None):
        nonlocal counter
        result=subprocess.run(args,input=data,capture_output=True,text=True,timeout=30)
        counter+=1;private_file(PROOF/(str(counter).zfill(3)+'.log'),result.stdout+'\n'+result.stderr)
        if result.returncode:raise RuntimeError('Fixed read-only recovery continuation refused')
        return result.stdout.strip()
    with fixed_trial_guard():
        record=json.loads((ARCHIVE/'CONNECTED_PRESERVATION_RESULT.json').read_bytes())
        assert len(record['volumes'])==1;selected=record['volumes'][0];archive=ARCHIVE/selected['archive']
        assert digest_file(archive)==selected['archiveSha256']
        assert (FIRST/'RESTORE_FAILURE.json').is_file()
        meta=json.loads(run(['docker','inspect','--format','{"image":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}',TARGET]))
        assert meta['image']==IMAGE and meta['labels']=={'terrafracta.frozen-launch-recovery':'20261002'} \
            and meta['running'] is False and meta['network']=='none' and meta['ports']=={} \
            and len(meta['mounts'])==1 and meta['mounts'][0]['Name']==TARGET and meta['mounts'][0]['Destination']=='/restore'
        try:
            run(['docker','start',TARGET]);started=True
            import time
            for _ in range(20):
                check=subprocess.run(['docker','exec',TARGET,BIN+'pg_isready','-h','/tmp','-U','postgres'],capture_output=True,timeout=5)
                if check.returncode==0:break
                time.sleep(.2)
            def query(db,sql):return run(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'],data='begin read only;'+sql+'rollback;')
            assert query('postgres',"select count(*) from pg_roles where rolname like 'terra_%' and rolcanlogin;")=='0'
            extra=extra_readback(query)
            assert digest_file(archive)==selected['archiveSha256']
            result={'evidenceKind':'read_only_completion_of_actual_frozen_launch_restore',
                'observedAt':datetime.now(timezone.utc).isoformat(),'firstFailedProbeRetained':True,
                'newPhysicalCopyCreated':False,'nativeDatabaseChanged':False,'applicationLogins':0,
                'sourceArchiveUnchanged':True,'archivedCodeExecuted':False,'actualSourceRequests':0,
                'network':'none','hostPorts':0,'primaryChanged':False,'additionalReadback':extra}
            private_file(PROOF/'RESTORE_COMPLETION_RESULT.json',json.dumps(result,indent=2)+'\n')
        except BaseException as error:
            private_file(PROOF/'RESTORE_COMPLETION_FAILURE.json',json.dumps({'exceptionType':type(error).__name__,
                'sourceArchiveRetained':True,'firstFailureRetained':True,'primaryChanged':False})+'\n');raise
        finally:
            if started:run(['docker','stop','--timeout','10',TARGET])
    print(json.dumps({**result,'restoredCloneStopped':True},indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
