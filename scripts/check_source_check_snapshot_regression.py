"""One-shot reproduce the stale-snapshot byte-ledger flaw on invented data.

An expected reproduction is a diagnosed FAILURE, not platform acceptance.
Retains the inconsistent fictional run and exact private diagnostic evidence.
Never targets primary, resets, erases history or accepts connection arguments.
"""

from dataclasses import replace
import json
from pathlib import Path
import subprocess
import sys

from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.check_run_completion_commit import ARGS,CONTAINER,NETWORK,PORT,STATE,query,wait_for_block
from scripts.fictional_run_admission_cases import fictional_request
from workers.update_request_identity import canonical_update_request,identify_update_request


def main() -> int:
    if sys.argv[1:]:
        raise RuntimeError("Fixed snapshot regression accepts no arguments")
    metadata=json.loads(subprocess.run(["docker","inspect","--format",
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}',CONTAINER],
        text=True,capture_output=True,check=True,timeout=10).stdout)
    assert metadata["ports"]["5432/tcp"]==[{"HostIp":"127.0.0.1","HostPort":PORT}] and set(metadata["networks"])=={NETWORK}
    assert json.loads(query(STATE))=={"migrations":30,"runs":3,"versions":1,"decisions":2,
        "manifests":3,"closeouts":3,"activations":1,"heads":1}
    evidence=Path('/tmp/terrafracta-source-check-snapshot-failure-20260930.json'); assert not evidence.exists()
    second='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    query("""insert into terra_private.source_registrations(id,source_key,publisher,exact_endpoint,
      registration_state,allow_fetch,fetch_enabled,reviewed_at)
      values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fictional-byte-ledger','Fictional publisher',
       'https://example.org/fictional-byte-ledger','approved',true,true,clock_timestamp()-interval '1 second');""")
    request=replace(fictional_request(),request_key='fictional:completion:snapshot-regression',
                    scope='fictional-activation-country',mode='publish_eligible')
    fingerprint=identify_update_request(request).request_fingerprint
    admission=json.loads(query('select terra_private.admit_update_run('+quote(request.request_key)+','+quote(canonical_update_request(request))+');'))
    run_id=admission['runId']
    work=json.loads(query('select terra_private.claim_update_run_work('+quote(run_id)+','+quote(fingerprint)+',gen_random_uuid());'))
    a,b=Session(ARGS),Session(ARGS)
    try:
        settings="set statement_timeout='15s';set lock_timeout='10s';"
        a.execute(settings,"AREADY"); b.execute(settings,"BREADY")
        apid=int(a.execute('select pg_backend_pid();','APID')[0]); bpid=int(b.execute('select pg_backend_pid();','BPID')[0])
        for session,marker in ((a,'ASNAPSHOT'),(b,'BSNAPSHOT')):
            assert session.execute('begin isolation level repeatable read;select count(*) from terra_private.update_run_source_checks where run_id='+quote(run_id)+';',marker)==['0']
        def insert(registration,key):
            return 'insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,outcome,total_response_bytes,work_claim_id) values('+','.join((quote(run_id),quote(registration),quote(key),"'failed'",'1500000',quote(work['leaseId'])))+');'
        a.execute(insert('33333333-3333-4333-8333-333333333333','fictional-source'),'FIRSTLOCKED')
        b.send(insert(second,'fictional-byte-ledger'),'SECONDWAITING')
        wait_for_block(bpid,apid)
        a.execute('commit;','FIRSTCOMMITTED')
        b.until('SECONDWAITING'); b.execute('commit;','SECONDCOMMITTED')
        observed=json.loads(query('select jsonb_build_object(\'recordedBytes\',sum(total_response_bytes),\'checks\',count(*)) from terra_private.update_run_source_checks where run_id='+quote(run_id)+';'))
        assert observed=={'recordedBytes':3000000,'checks':2}
        with evidence.open('x') as handle:
            evidence.chmod(0o600)
            json.dump({'evidenceKind':'confirmed_fictional_snapshot_failure','isolation':'repeatable read',
                'admittedByteCap':2000000,**observed,'actualSourceFetches':0,'publicChanges':0,
                'disposition':'preserve_failed_trial_and_correct_before_primary_installation'},handle,indent=2)
        print('CONFIRMED FAILURE: an old snapshot accepted two invented 1.5 MB receipts under a 2 MB cap.')
        print('Observed real lock wait; no source was fetched and no fact was published. Inconsistent trial retained for diagnosis.')
    finally:
        b.close(); a.close()
    return 0


if __name__=='__main__':
    raise SystemExit(main())
