"""One-shot byte-cap race and isolation denials on the corrected test volume.

No primary, fetch, publication, reset or caller-selected target. Preserve the
earlier failed snapshot trial on its separate volume and all new trial rows.
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
from workers.update_run_completion import canonical_run_manifest


def query(sql):
    return owner_query(CONTAINER, sql)


def make_run(name):
    request = replace(fictional_request(), request_key='fictional:completion:fixed-' + name,
                      scope='fictional-activation-country', mode='publish_eligible')
    fingerprint = identify_update_request(request).request_fingerprint
    admission = json.loads(query('select terra_private.admit_update_run(' +
        quote(request.request_key) + ',' + quote(canonical_update_request(request)) + ');'))
    assert admission['status'] == 'admitted'
    run_id = admission['runId']
    work = json.loads(query('select terra_private.claim_update_run_work(' +
        quote(run_id) + ',' + quote(fingerprint) + ',gen_random_uuid());'))
    assert work['status'] == 'claimed'
    return run_id, fingerprint, work['leaseId']


def failed_insert(run_id, lease, registration, key):
    return 'insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,outcome,total_response_bytes,work_claim_id) values(' + ','.join((quote(run_id), quote(registration), quote(key), "'failed'", '1500000', quote(lease))) + ');'


def must_deny(sql, expected):
    result = subprocess.run(ARGS, input=sql, text=True, capture_output=True, timeout=15)
    assert result.returncode != 0 and expected in result.stderr, 'Expected refusal was not observed'


def main():
    if sys.argv[1:]:
        raise RuntimeError('Fixed concurrency correction accepts no arguments')
    meta = json.loads(subprocess.run(['docker', 'inspect', '--format',
        '{"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}', CONTAINER],
        text=True, capture_output=True, check=True, timeout=10).stdout)
    assert meta['ports']['5432/tcp'] == [{'HostIp': '127.0.0.1', 'HostPort': '64832'}]
    assert set(meta['networks']) == {NETWORK}
    before = json.loads(query(STATE))
    assert before == {'migrations':30,'runs':1,'versions':1,'checks':1,'manifests':1,'activations':1,'closeouts':1,'heads':1}
    evidence = Path('/tmp/terrafracta-source-check-concurrency-fix-20260930.json')
    assert not evidence.exists(), 'Never replace prior trial evidence'
    second = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    first = '33333333-3333-4333-8333-333333333333'
    query("""insert into terra_private.source_registrations(id,source_key,publisher,exact_endpoint,
      registration_state,allow_fetch,fetch_enabled,reviewed_at) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fictional-byte-ledger','Fictional publisher',
       'https://example.org/fictional-byte-ledger','approved',true,true,clock_timestamp()-interval '1 second');""")
    run_id, fingerprint, lease = make_run('byte-race')
    a,b = Session(ARGS),Session(ARGS)
    try:
        settings = "set statement_timeout='15s';set lock_timeout='10s';"
        a.execute(settings,'AREADY'); b.execute(settings,'BREADY')
        apid = int(a.execute('select pg_backend_pid();','APID')[0])
        bpid = int(b.execute('select pg_backend_pid();','BPID')[0])
        a.execute('begin;' + failed_insert(run_id,lease,first,'fictional-source'),'FIRSTLOCKED')
        b.send('begin;' + failed_insert(run_id,lease,second,'fictional-byte-ledger'),'SECONDWAITING')
        deadline = time.monotonic() + 3
        while query(f'select {apid}=any(pg_blocking_pids({bpid}));') != 't':
            assert time.monotonic() < deadline, 'Actual lock wait not observed'
            time.sleep(0.05)
        a.execute('commit;','FIRSTCOMMITTED')
        try:
            b.until('SECONDWAITING')
        except RuntimeError:
            assert any('admitted byte bounds' in error for error in b.errors)
        else:
            raise AssertionError('Second over-cap receipt unexpectedly accepted')
        bytes_state = json.loads(query("select jsonb_build_object('recordedBytes',sum(total_response_bytes),'checks',count(*)) from terra_private.update_run_source_checks where run_id=" + quote(run_id) + ';'))
        assert bytes_state == {'recordedBytes':1500000,'checks':1}
    finally:
        b.close(); a.close()
    denied = []
    for isolation in ('repeatable read','serializable'):
        must_deny('begin isolation level ' + isolation + ';' + failed_insert(run_id,lease,second,'fictional-byte-ledger'), 'Processing writes require read committed isolation')
        denied.append(isolation + ':source-check')
    # A fresh unchanged receipt reuses the retained content; no new fetch/version.
    planned_run, planned_fp, planned_lease = make_run('isolation-closeout')
    plan = replace(fictional_completion_manifest(),run_id=planned_run,request_fingerprint=planned_fp)
    source = plan.sources[0]
    query('insert into terra_private.update_run_source_checks(run_id,registration_id,source_key,source_version_id,content_sha256,outcome,total_response_bytes,work_claim_id) values(' + ','.join((quote(planned_run),quote(source.registration_id),quote(source.source_key),quote(source.source_version_id),quote(source.content_sha256),"'unchanged'",'512',quote(planned_lease))) + ');')
    manifest_sql = 'insert into terra_private.update_run_manifests(run_id,canonical_manifest,manifest_sha256,work_claim_id) values(' + ','.join((quote(planned_run),quote(canonical_run_manifest(plan)),"encode(sha256(convert_to(" + quote(canonical_run_manifest(plan)) + ",'UTF8')),'hex')",quote(planned_lease))) + ');'
    for isolation in ('repeatable read','serializable'):
        must_deny('begin isolation level ' + isolation + ';' + manifest_sql,'Processing writes require read committed isolation')
        denied.append(isolation + ':manifest')
    query(manifest_sql)
    manifest_hash = query('select manifest_sha256 from terra_private.update_run_manifests where run_id=' + quote(planned_run) + ';')
    close_sql = 'select terra_private.close_update_run_processing(' + ','.join(map(quote,(planned_run,planned_fp,planned_lease,manifest_hash))) + ');'
    for isolation in ('repeatable read','serializable'):
        must_deny('begin isolation level ' + isolation + ';' + close_sql,'Processing writes require read committed isolation')
        denied.append(isolation + ':closeout')
    receipt = json.loads(query(close_sql))
    assert receipt['summary']['runState'] == 'partial' and len(receipt['summary']['pendingItemKeys']) == 1
    after = json.loads(query(STATE))
    assert after == {'migrations':30,'runs':3,'versions':1,'checks':3,'manifests':2,'activations':1,'closeouts':2,'heads':1}
    with evidence.open('x') as handle:
        evidence.chmod(0o600)
        json.dump({'evidenceKind':'corrected_fictional_concurrency','recordedAt':datetime.now(timezone.utc).isoformat(),
                   'actualLockWait':True,'admittedByteCap':2000000,**bytes_state,'isolationDenials':denied,
                   'finalState':after,'actualSourceFetches':0,'newPublications':0},handle,indent=2)
    print('PASS actual READ COMMITTED race: second 1.5 MB receipt refused, committed sum 1.5 MB under 2 MB cap.')
    print('PASS six unsupported-isolation write refusals; ordinary partial closeout still commits.')
    print('Earlier failed trial and new fictional evidence preserved; no primary mutation, source fetch or new publication.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
