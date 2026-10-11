"""Actual fixed-clone lost start acknowledgement and cooperative TERM cases.

Fault immediately after the real daemon start, before the driver sees its ACK.
No database/account creation is reached. This is not SIGKILL containment.
"""
from datetime import datetime, timezone
import json
import os
import secrets
import signal
import sys
import time
from unittest.mock import patch

from scripts import run_authenticated_successor_pipeline as successor
from scripts.captured_fictional_pipeline import private_file
from scripts.fictional_trial_guard import fixed_trial_guard, FictionalTrialInterrupted


def stopped():
    meta=json.loads(successor.command(['docker','inspect','--format',
        '{"image":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}',successor.TARGET]).stdout)
    assert meta=={'image':successor.IMAGE,'labels':{'terrafracta.capture-auth':'20261001'},'running':False,'network':'none','ports':{}}
    return meta


def catalog(proof,label):
    stopped();attempted=False
    try:
        attempted=True
        assert successor.command(['docker','start',successor.TARGET],timeout=15).returncode==0
        for _ in range(20):
            ready=successor.command(['docker','exec',successor.TARGET,successor.BIN+'pg_isready','-h','/tmp','-U','postgres'],timeout=5)
            if ready.returncode==0:break
            time.sleep(.2)
        assert ready.returncode==0
        sql="select json_build_object('databases',(select json_agg(datname order by datname) from pg_database),'roles',(select json_agg(json_build_object('name',rolname,'login',rolcanlogin) order by rolname) from pg_roles));"
        result=successor.command(['docker','exec','-i',successor.TARGET,successor.BIN+'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],data=sql,timeout=15)
        assert result.returncode==0
        private_file(proof/(label+'_CATALOG.json'),result.stdout)
        value=json.loads(result.stdout)
        assert not any(row['login'] for row in value['roles'] if row['name'].startswith('terra_'))
        return value
    finally:
        if attempted:assert successor.command(['docker','stop','--timeout','10',successor.TARGET],timeout=20).returncode==0


def main():
    if sys.argv[1:]:raise ValueError('Fixed startup-ACK trial accepts no arguments')
    with fixed_trial_guard():
        proof=successor.PRIVATE/('successor-start-ack-'+datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+secrets.token_hex(3))
        proof.mkdir(mode=0o700);before=catalog(proof,'BEFORE');results=[]
        real_command=successor.command
        for fault in ('lost_start_ack','cooperative_term_during_start'):
            stopped();started=[];original_type=None
            def command(args,**kwargs):
                result=real_command(args,**kwargs)
                if args[:2]==['docker','start']:
                    assert result.returncode==0;started.append(True)
                    if fault=='lost_start_ack':raise OSError('Invented lost daemon acknowledgment after actual start')
                    os.kill(os.getpid(),signal.SIGTERM)
                    raise RuntimeError('Owned cooperative TERM was not delivered')
                return result
            with patch.object(successor,'command',side_effect=command):
                try:successor.trial()
                except (OSError,FictionalTrialInterrupted) as error:original_type=type(error).__name__
            assert started==[True] and original_type==('OSError' if fault=='lost_start_ack' else 'FictionalTrialInterrupted')
            after=stopped();current=catalog(proof,fault.upper());assert current==before
            results.append({'fault':fault,'originalExceptionType':original_type,'actualDaemonStartConfirmed':True,
                'ownedCloneStoppedAfterFailure':after['running'] is False,'databaseAndAccountCatalogUnchanged':True})
        receipt={'evidenceKind':'actual_fixed_successor_start_ack_faults','observedAt':datetime.now(timezone.utc).isoformat(),
            'cases':results,'sourceRequests':0,'modelCalls':0,'primaryChanged':False,'hardLossContainmentVerified':False,
            'temporaryAccountCreationReached':False,'ownedCloneStopped':True,'privateEvidenceDirectory':str(proof)}
        private_file(proof/'START_ACK_NATIVE_RESULT.json',json.dumps(receipt,indent=2)+'\n')
        print(json.dumps(receipt,indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
