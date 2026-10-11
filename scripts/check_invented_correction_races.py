"""Two actual ordinary-client lock orders; only fixed invented draft bytes.

Reuse the unchanged closed v2 correction SQL and actual first/successor driver.
The existing bounded Session is intercepted only at its activation test seam.
No real intake, source, browser, primary migration or reviewer authority.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import secrets
import sys
import time
from unittest.mock import patch

from scripts import check_authenticated_publication_pipeline as publication
from scripts import check_invented_correction_intake as intake
from scripts.captured_fictional_pipeline import ROOT, private_file
from scripts.check_authenticated_capture_pipeline import command, sensitive_admin
from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_successor_pipeline import trial

ORDERS = ('correction_first', 'successor_first')

def draft_wire(projection):
    result = command(['node', '--experimental-strip-types', 'scripts/build_invented_correction_wire.mjs'],
                     data=json.dumps(projection), timeout=5)
    if result.returncode or len(result.stdout.encode()) > 16384:
        raise ValueError('Fixed invented draft wire refused')
    wire = json.loads(result.stdout)
    if set(wire) != {'schemaVersion','evidenceKind','requests','sourceRequests','realReports','submissionEnabled'} \
            or type(wire['schemaVersion']) is not int or wire['schemaVersion'] != 1 or wire['evidenceKind'] != 'checked_invented_correction_wire' \
            or type(wire['sourceRequests']) is not int or wire['sourceRequests'] != 0 \
            or type(wire['realReports']) is not int or wire['realReports'] != 0 or wire['submissionEnabled'] is not False \
            or len(wire['requests']) != 2:
        raise ValueError('Invented wire contract differs')
    for index, request in enumerate(wire['requests']):
        expected = {key:projection[key] for key in ('issueId','publicationId','revision','jurisdictionSlug','issueSlug')}
        expected['claimId'] = projection['claims'][0]['id'] if index == 0 else None
        if request != {'target':expected,'fields':intake.FIELDS}:
            raise ValueError('Invented wire target differs')
    return wire

def run_case(order):
    if order not in ORDERS: raise ValueError('Invalid fixed race order')
    candidate = intake.CANDIDATE.read_bytes(); pin = sha256(candidate).hexdigest()
    state = {'armed':False,'created':False,'completed':False}
    sessions = []
    def submit_sql():
        request = state['wire']['requests'][0]
        return 'select terra_correction_test_api.submit_report(' + quote(json.dumps(request['target'])) + '::jsonb,' + quote(json.dumps(request['fields'])) + '::jsonb);'
    def queue_bytes(label):
        return state['owner']("select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]'::jsonb) from terra_private.correction_reports c;",label)
    def correction_session():
        session = Session(intake.client_args(state['role'],state['database']))
        sessions.append(session)
        session.process.stdin.write(state['password']+'\n'); session.process.stdin.flush()
        return session
    def wait_block(waiter, blocker):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if state['owner']('select '+str(blocker)+'=any(pg_blocking_pids('+str(waiter)+'));',order+'_lock_wait') == 't': return
            time.sleep(.025)
        raise ValueError('Exact invented client lock wait not observed')
    class RaceSession(Session):
        def execute(self, sql, marker):
            if not state['armed']: return super().execute(sql, marker)
            if marker == 'ACTIVATED':
                if state.get('raced') or sql != 'begin;select terra_publication_test_api.activate_fact();':
                    raise ValueError('Fixed activation seam differs')
                state['raced'] = True
                publication_pid = int(super().execute('select pg_backend_pid();','PUBPID')[0])
                correction = correction_session()
                correction_pid = int(correction.execute('select pg_backend_pid();','CORRECTIONPID')[0])
                state['correction'] = correction
                if order == 'correction_first':
                    rows = correction.execute('begin;'+submit_sql(),'CORRECTIONHELD')
                    assert len(rows) == 1
                    state['receipt'] = json.loads(rows[0])
                    assert state['receipt']['status'] == 'recorded_private'
                    assert state['receipt']['publicationId'] == state['wire']['requests'][0]['target']['publicationId']
                    assert state['receipt']['revision'] == 1
                    self.send(sql, marker)
                    wait_block(publication_pid, correction_pid)
                    assert state['owner']('select count(*) from terra_private.correction_reports;',order+'_uncommitted_queue') == '0'
                    correction.execute('commit;','CORRECTIONCOMMITTED')
                    state['wholeOldReport'] = queue_bytes(order+'_whole_old_report')
                    correction.close(); sessions.remove(correction)
                    return self.until(marker)
                rows = super().execute(sql, marker)
                correction.send('begin;'+submit_sql(),'STALECORRECTION')
                wait_block(correction_pid, publication_pid)
                assert state['owner']('select count(*) from terra_private.correction_reports;',order+'_uncommitted_queue') == '0'
                return rows
            rows = super().execute(sql, marker)
            if marker == 'COMMITTED':
                if order == 'successor_first':
                    correction = state['correction']
                    try: correction.until('STALECORRECTION')
                    except RuntimeError:
                        correction.process.wait(timeout=5)
                        assert correction.process.returncode != 0
                        assert any('Invented correction target is unavailable or changed' in line for line in correction.errors)
                        state['targetChangedErrorObserved'] = True
                    else: raise ValueError('Stale invented correction committed after successor')
                    correction.close(); sessions.remove(correction)
                state['completed'] = True
                state['armed'] = False
            return rows
    def observe(phase, projection, database, proof, owner):
        if intake.CANDIDATE.read_bytes() != candidate: raise ValueError('Correction candidate changed')
        if phase == 'first':
            state.update(database=database,proof=proof,owner=owner,wire=draft_wire(projection))
            role = 'terra_correction_first_' + proof.name.removeprefix('authenticated-successor-')
            password = secrets.token_urlsafe(48)
            state.update(role=role,password=password)
            private_file(proof/'EXACT_RACE_CORRECTION_CANDIDATE.sql',candidate.decode())
            private_file(proof/'ACTUAL_TYPESCRIPT_CORRECTION_WIRE.json',json.dumps(state['wire'],indent=2)+'\n')
            owner('begin;'+candidate.decode()+'commit;',order+'_candidate')
            state['roleAttempted'] = True
            sensitive_admin('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password '+quote(password)+';')
            state['created'] = True
            owner('insert into terra_correction_test_api.principal_scopes values('+quote(role)+','+quote(projection['issueId'])+
                  ",clock_timestamp()+interval '3 minutes',true,encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex'));grant usage on schema terra_correction_test_api to "+role+
                  ';grant execute on function terra_correction_test_api.submit_report(jsonb,jsonb) to '+role+';',order+'_scope')
            state['armed'] = True
        else:
            assert state['completed'] and state['raced']
            expected_count = 1 if order == 'correction_first' else 0
            assert owner('select count(*) from terra_private.correction_reports;',order+'_final_queue') == str(expected_count)
            if expected_count:
                assert queue_bytes(order+'_whole_report_after_successor') == state['wholeOldReport']
                request = state['wire']['requests'][0]
                exact = json.loads(owner("select jsonb_build_object('publicationId',publication_id,'claimId',claim_id,'kind',report_kind,'details',details,'sourceUrl',source_url,'reviewState',review_state,'reviewedAt',reviewed_at,'resolution',resolution_note) from terra_private.correction_reports;",order+'_exact_old_report'))
                assert exact == {'publicationId':request['target']['publicationId'],'claimId':request['target']['claimId'],
                    **request['fields'],'reviewState':'new','reviewedAt':None,'resolution':None}
            denied = intake.client(state['role'],state['password'],database,submit_sql())
            assert denied.returncode != 0
            assert 'Invented correction target is unavailable or changed' in denied.stderr
            assert owner('select count(*) from terra_private.correction_reports;',order+'_queue_after_stale') == str(expected_count)
    def cleanup(owner):
        failures = []
        for session in list(sessions):
            try: session.close()
            except BaseException as error: failures.append(type(error).__name__)
            finally: sessions.remove(session)
        if state.get('roleAttempted'):
            try:
                exists = owner('select exists(select 1 from pg_roles where rolname='+quote(state['role'])+');',order+'_correction_role_exists',database='postgres')
                assert exists in ('t','f')
                if exists == 't':
                    sensitive_admin('alter role '+state['role']+' nologin;')
                    assert owner('select rolcanlogin from pg_roles where rolname='+quote(state['role'])+';',order+'_retired_correction',database='postgres') == 'f'
            except BaseException as error: failures.append(type(error).__name__)
        state['password'] = ''
        if failures: raise RuntimeError('Fixed invented race cleanup requires retained-state inspection')
    with fixed_trial_guard(), patch.object(publication,'Session',RaceSession):
        result = trial(projection_observer=observe,trial_cleanup=cleanup)
    receipt = {'evidenceKind':'actual_invented_correction_successor_lock_order','order':order,
        'observedAt':datetime.now(timezone.utc).isoformat(),'candidateSha256':pin,
        'actualBlockingPidsObserved':True,'actualTypeScriptDraftWireUsed':True,
        'privateReports':1 if order == 'correction_first' else 0,'stalePostSuccessorRefused':True,
        'oldReportTargetPreserved':order == 'correction_first','sourceRequests':0,'realReports':0,
        'wholeOldReportBytesPreserved':order == 'correction_first',
        'specificBlockedTargetChangedErrorObserved':state.get('targetChangedErrorObserved',False),
        'primaryChanged':False,'liveIntakeEnabled':False,'browserVerified':False,
        'temporaryAccountsRetired':True,'ownedCloneStopped':True,'privateEvidenceDirectory':str(state['proof'])}
    private_file(state['proof']/'CORRECTION_SUCCESSOR_RACE_RESULT.json',json.dumps(receipt,indent=2)+'\n')
    return receipt

def main():
    if sys.argv[1:]: raise ValueError('Fixed invented races accept no arguments')
    results = [run_case(order) for order in ORDERS]
    print(json.dumps({'evidenceKind':'actual_invented_correction_successor_two_orders','cases':results},indent=2))
    return 0

if __name__ == '__main__': raise SystemExit(main())
