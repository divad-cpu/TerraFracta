"""Actual narrow ordinary reviewer with transactional, append-only history.

Fresh invented-only first/successor reports come from their actual typed request
wire and ordinary submit_request. Historical classification never edits facts.
No primary change, real report, contact, notification or privacy-policy choice.
"""
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import secrets
import sys
import time

from scripts import check_invented_correction_intake as intake
from scripts import check_invented_correction_reliability as reliability
from scripts.captured_fictional_pipeline import ROOT, REG, private_file
from scripts.check_archived_completion_restore import BIN
from scripts.check_authenticated_capture_pipeline import TARGET, command, sensitive_admin
from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_successor_pipeline import trial

REVIEW = ROOT / 'research/pending/TF007_invented_correction_review.sql'
NOTE = 'Invented technical closure; no public content was changed.'
EVENT_IDS = ('e8a11111-1111-4111-8111-111111111111', 'e8a22222-2222-4222-8222-222222222222',
             'e8a33333-3333-4333-8333-333333333333', 'e8a44444-4444-4444-8444-444444444444')


def reviewer_args(role, database):
    match = re.fullmatch(r'terra_correction_review_([0-9]{14}_[0-9a-f]{6})', role)
    if match is None or database != 'terra_successor_' + match[1]: raise ValueError('Invalid fixed reviewer client')
    shell = 'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGPASSFILE=/dev/null PGSSLMODE=disable PGCONNECT_TIMEOUT=3; exec ' + BIN + 'psql -h 127.0.0.1 -U ' + role + ' -d ' + database + ' -X -qAt -v ON_ERROR_STOP=1'
    return ['docker', 'exec', '-i', TARGET, 'sh', '-c', shell]


def checked_result(kind, request, result):
    if kind not in ('request','review','status'):
        raise ValueError('Invalid fixed correction contract kind')
    packet = {'kind': kind, 'request': request, 'result': result}
    checked = command(['node', '--experimental-strip-types', 'scripts/check_invented_correction_results.mjs'], data=json.dumps(packet), timeout=5)
    expected = {'schemaVersion': 1, 'evidenceKind': 'checked_private_invented_correction_contract', 'kind': kind,
                'sourceRequests': 0, 'liveIntakeEnabled': False}
    if checked.returncode or len(checked.stdout.encode('utf-8')) > 4096:
        raise ValueError('Actual private correction contract differs')
    observed = json.loads(checked.stdout)
    if type(observed) is not dict or observed != expected \
            or type(observed.get('schemaVersion')) is not int \
            or type(observed.get('sourceRequests')) is not int \
            or observed.get('liveIntakeEnabled') is not False:
        raise ValueError('Actual private correction contract differs')
    return result


def review_sql(request):
    return 'select terra_correction_test_api.review_report(' + quote(json.dumps(request)) + '::jsonb);'


def main(*,custody=None):
    if sys.argv[1:]: raise ValueError('Fixed invented review trial accepts no arguments')
    if custody is not None:
        from workers.invented_review_custody import ReviewWorkerCustody
        if type(custody) is not ReviewWorkerCustody:raise ValueError('Invalid fixed review custody')
    candidates = {path: path.read_bytes() for path in (intake.CANDIDATE, reliability.RELIABILITY, REVIEW)}
    pins = {path.name: sha256(body).hexdigest() for path, body in candidates.items()}
    if custody is not None and pins!=custody.pins:
        raise ValueError('Fixed custody candidate binding differs before start')
    assert pins[intake.CANDIDATE.name] == 'f429be4fff02b48d07b841d2bc568b24d45f09e945b9ac64eab1b0597fd8953b'
    state = {'roles': [], 'sessions': [], 'reports': [], 'denials': [], 'completed': False}

    def close(selected):
        selected.close(); state['sessions'].remove(selected)

    def observe(phase, projection, database, proof, owner):
        if any(path.read_bytes() != body for path, body in candidates.items()): raise ValueError('Review candidate changed')
        state.update(proof=proof, database=database)
        if phase == 'first':
            for path, body in candidates.items(): private_file(proof / ('EXACT_' + path.name), body.decode())
            owner('begin;' + ''.join(body.decode() for body in candidates.values()) + 'commit;', 'invented_review_candidates')
        suffix = proof.name.removeprefix('authenticated-successor-')
        role = 'terra_correction_' + phase + '_' + suffix; password = secrets.token_urlsafe(48)
        state['roles'].append((role, password))
        sensitive_admin('create role ' + role + ' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password ' + quote(password) + ';')
        owner('insert into terra_correction_test_api.principal_scopes values(' + quote(role) + ',' + quote(projection['issueId']) +
              ",clock_timestamp()+interval '4 minutes',true,encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex'));grant usage on schema terra_correction_test_api to " + role +
              ';grant execute on function terra_correction_test_api.submit_request(jsonb) to ' + role + ';', phase + '_review_report_scope')
        wire = reliability.request_wire(projection)
        for label, invalid_id in (('version9','f8a55555-5555-9555-8555-555555555555'),
                                  ('variant0','f8a55555-5555-4555-0555-555555555555')):
            invalid = {**wire['requests'][0], 'requestId': invalid_id}
            refused = intake.client(role, password, database, reliability.submit_sql(invalid))
            assert refused.returncode != 0 and 'Invented correction request refused' in refused.stderr
            assert owner('select count(*) from terra_private.correction_reports;', phase + '_invalid_request_' + label) == str(len(state['reports']))
            private_file(proof / (phase + '-INVALID_REQUEST_UUID_' + label + '.log'), refused.stdout + '\n' + refused.stderr)
        for index, request in enumerate(wire['requests']):
            result = intake.client(role, password, database, reliability.submit_sql(request)); assert result.returncode == 0
            receipt = checked_result('request', request, json.loads(result.stdout))
            assert receipt['replayed'] is False
            state['reports'].append({'revision': projection['revision'], 'target': 'claim' if index == 0 else 'page', 'receipt': receipt})
        if phase == 'first':
            if custody is not None:custody.first_reports()
            return
        reviewer = 'terra_correction_review_' + suffix; review_password = secrets.token_urlsafe(48)
        state['roles'].append((reviewer, review_password))
        sensitive_admin('create role ' + reviewer + ' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password ' + quote(review_password) + ';')
        owner('insert into terra_correction_test_api.reviewer_scopes values(' + quote(reviewer) + ',' + quote(projection['issueId']) +
            ",clock_timestamp()+interval '8 minutes',true);grant usage on schema terra_correction_test_api to " + reviewer +
            ';grant execute on function terra_correction_test_api.review_report(jsonb),terra_correction_test_api.read_review_status(uuid) to ' + reviewer + ';', 'invented_reviewer_scope')
        old_id = state['reports'][0]['receipt']['reportId']; new_id = state['reports'][2]['receipt']['reportId']
        start = {'schemaVersion': 1, 'eventId': EVENT_IDS[0], 'reportId': old_id, 'expectedState': 'new', 'nextState': 'in_review', 'resolutionNote': None}
        def client(sql): return command(reviewer_args(reviewer, database), data=review_password + '\n' + sql, timeout=15)
        def call(request): return client(review_sql(request))
        def current(selected_report):
            result = client('select terra_correction_test_api.read_review_status(' + quote(selected_report) + '::uuid);'); assert result.returncode == 0
            return checked_result('status', None, json.loads(result.stdout))
        def event_bytes(): return owner("select coalesce(jsonb_agg(to_jsonb(e) order by report_id,sequence),'[]'::jsonb) from terra_correction_test_api.review_events e;", 'review_events_exact_readback')
        def invariant_bytes():
            return owner("select jsonb_build_object('reports',(select jsonb_agg(jsonb_build_object('id',id,'issue',issue_id,'publication',publication_id,'claim',claim_id,'kind',report_kind,'details',details,'url',source_url,'reported',reported_at) order by id) from terra_private.correction_reports),'receipts',(select jsonb_agg(to_jsonb(r) order by principal,request_id) from terra_correction_test_api.request_receipts r),'publications',(select jsonb_agg(to_jsonb(p) order by id) from terra_private.issue_publications p),'heads',(select jsonb_agg(to_jsonb(h) order by issue_id) from terra_private.issue_heads h));", 'review_unchanged_identity_content')
        baseline = invariant_bytes()
        def deny(label, request=None, sql=None, error=None):
            before = event_bytes()
            result = client(sql) if sql is not None else call(request)
            assert result.returncode != 0 and (error is None or error in result.stderr), label
            assert event_bytes() == before
            assert invariant_bytes() == baseline
            state['denials'].append(label)
            private_file(proof / ('REVIEW_DENIED_' + label + '.json'), json.dumps({'refused': True, 'eventsAndContentUnchanged': True}) + '\n')
        for label, sql in (
            ('report_table_read', 'select * from terra_private.correction_reports;'),
            ('event_table_read', 'select * from terra_correction_test_api.review_events;'),
            ('scope_table_update', 'update terra_correction_test_api.reviewer_scopes set enabled=true;'),
            ('event_delete', 'delete from terra_correction_test_api.review_events;'),
            ('review_table_update', "update terra_private.correction_reports set review_state='closed';"),
            ('private_helper', 'select terra_correction_test_api.current_reviewer_scope();'),
            ('intake_write', "select terra_correction_test_api.submit_request('{}'::jsonb);"),
            ('public_activation', 'select terra_publication_test_api.activate_fact();'),
            ('owner_role', 'set role postgres;'),
        ): deny(label, sql=sql)
        for denied_role in ('anon','authenticated','service_role','terra_collector','terra_operator','terra_reviewer','terra_issue_reader'):
            for signature in ('review_report(jsonb)', 'read_review_status(uuid)', 'current_reviewer_scope()'):
                assert owner('select has_function_privilege(' + quote(denied_role) + ',' + quote('terra_correction_test_api.' + signature) + ",'execute');", 'review_grant_' + denied_role + '_' + signature.split('(')[0]) == 'f'
        provisional = client('begin;' + review_sql(start) + 'rollback;'); assert provisional.returncode == 0
        assert current(old_id)['reviewState'] == 'new' and event_bytes() == '[]'
        def session():
            selected = Session(reviewer_args(reviewer, database)); state['sessions'].append(selected)
            selected.process.stdin.write(review_password + '\n'); selected.process.stdin.flush()
            return selected
        def wait_block(waiter, blocker):
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if owner('select ' + str(blocker) + '=any(pg_blocking_pids(' + str(waiter) + '));', 'review_exact_lock_wait') == 't': return
                time.sleep(.025)
            raise ValueError('Actual review lock wait not observed')
        first = session(); duplicate = session()
        first_pid = int(first.execute('select pg_backend_pid();', 'FIRSTPID')[0]); duplicate_pid = int(duplicate.execute('select pg_backend_pid();', 'DUPLICATEPID')[0])
        provisional_receipt = json.loads(first.execute('begin;' + review_sql(start), 'FIRSTEVENT')[0])
        duplicate.send('begin;' + review_sql(start), 'DUPLICATEEVENT'); wait_block(duplicate_pid, first_pid)
        private_file(proof / 'REVIEW_DUPLICATE_BLOCKING_PIDS.json', json.dumps({'blocker':first_pid,'waiter':duplicate_pid,'blockingWaitObserved':True}) + '\n')
        assert owner('select count(*) from terra_correction_test_api.review_events;', 'review_uncommitted_event_count') == '0'
        first.execute('commit;', 'FIRSTCOMMITTED')
        start_receipt = checked_result('review', start, provisional_receipt)
        repeated = json.loads(duplicate.until('DUPLICATEEVENT')[0]); duplicate.execute('commit;', 'DUPLICATECOMMITTED')
        checked_result('review', start, repeated); assert repeated == {**start_receipt, 'replayed': True}
        close(first); close(duplicate)
        assert current(old_id)['reviewState'] == 'in_review'
        conflict = {**start, 'reportId': new_id}; deny('same_event_conflict', conflict, error='Invented correction review request conflicts')
        deny('skipped_review', {**start, 'eventId': EVENT_IDS[3], 'nextState': 'closed', 'resolutionNote': NOTE}, error='Invented correction review input refused')
        deny('client_timestamp', {**start, 'reviewedAt': '2026-10-03T00:00:00Z'}, error='Invented correction review input refused')
        deny('client_actor', {**start, 'reviewer': 'client-selected'}, error='Invented correction review input refused')
        deny('missing_field', {key:value for key,value in start.items() if key != 'resolutionNote'}, error='Invented correction review input refused')
        deny('null_request', None, error='Invented correction review input refused')
        deny('unregistered_report', {**start, 'reportId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}, error='Invented correction review report unavailable')
        deny('nonstandard_isolation', sql='begin isolation level repeatable read;' + review_sql(start), error='Invented correction review isolation refused')
        for key in ('eventId','reportId'):
            for label, invalid_id in (('version9','e8a55555-5555-9555-8555-555555555555'),
                                      ('variant0','e8a55555-5555-4555-0555-555555555555')):
                deny('invalid_' + key + '_' + label, {**start,key:invalid_id}, error='Invented correction review input refused')
        for label, valid_id in (('nil_event_reaches_state_guard','00000000-0000-0000-0000-000000000000'),
                                ('max_event_reaches_state_guard','ffffffff-ffff-ffff-ffff-ffffffffffff')):
            deny(label, {**start,'eventId':valid_id}, error='Invented correction review state changed')

        # Historical private closure remains separate from current public rights.
        finish = {**start, 'eventId': EVENT_IDS[1], 'expectedState': 'in_review', 'nextState': 'closed', 'resolutionNote': NOTE}
        owner('update terra_private.source_registrations set allow_public_derived=false where id=' + quote(REG) + ';', 'review_fixture_rights_withdrawn')
        unconsumed = session(); unconsumed.send('begin;' + review_sql(finish) + 'commit;', 'UNCONSUMEDCLOSURE')
        deadline = time.monotonic() + 3
        while owner('select exists(select 1 from terra_correction_test_api.review_events where reviewer=' + quote(reviewer) + ' and event_id=' + quote(finish['eventId']) + ');', 'unconsumed_closure_commit') != 't':
            if time.monotonic() >= deadline: raise ValueError('Unconsumed closure commit not observed')
            time.sleep(.025)
        close(unconsumed)
        recovered = call(finish); assert recovered.returncode == 0
        closed_receipt = checked_result('review', finish, json.loads(recovered.stdout)); assert closed_receipt['replayed'] is True
        assert current(old_id)['reviewState'] == 'closed'
        historical_replay = call(start); assert historical_replay.returncode == 0
        assert checked_result('review', start, json.loads(historical_replay.stdout)) == repeated
        assert current(old_id)['reviewState'] == 'closed'
        owner('update terra_private.source_registrations set allow_public_derived=true where id=' + quote(REG) + ';', 'review_restore_fixture_rights')
        assert invariant_bytes() == baseline
        current_start = {**start, 'eventId': EVENT_IDS[2], 'reportId': new_id}
        competitor = {**current_start, 'eventId': EVENT_IDS[3]}
        a = session(); b = session(); a_pid = int(a.execute('select pg_backend_pid();', 'WINNERPID')[0]); b_pid = int(b.execute('select pg_backend_pid();', 'LOSERPID')[0])
        a_receipt = json.loads(a.execute('begin;' + review_sql(current_start), 'CURRENTREVIEW')[0])
        b.send('begin;' + review_sql(competitor), 'CONFLICTINGREVIEW'); wait_block(b_pid, a_pid)
        private_file(proof / 'REVIEW_COMPETING_BLOCKING_PIDS.json', json.dumps({'blocker':a_pid,'waiter':b_pid,'blockingWaitObserved':True}) + '\n')
        a.execute('commit;', 'CURRENTCOMMITTED'); checked_result('review', current_start, a_receipt)
        try: b.until('CONFLICTINGREVIEW')
        except RuntimeError:
            b.process.wait(timeout=5); assert b.process.returncode != 0
            assert any('Invented correction review state changed' in line for line in b.errors)
        else: raise ValueError('Competing reviewer transition ignored expected state')
        close(a); close(b)
        statuses = [current(row['receipt']['reportId']) for row in state['reports']]
        assert [status['reviewState'] for status in statuses] == ['closed','new','in_review','new']
        assert owner('select count(*) from terra_correction_test_api.review_events;', 'review_final_event_count') == '3'
        for action in ('update', 'delete'):
            sql = 'update terra_correction_test_api.review_events set recorded_at=recorded_at;' if action == 'update' else 'delete from terra_correction_test_api.review_events;'
            before = event_bytes()
            attempted = command(['docker','exec','-i',TARGET,BIN+'psql','-h','/tmp','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'], data=sql)
            assert attempted.returncode != 0 and 'Invented correction review event is append-only' in attempted.stderr
            private_file(proof / ('REVIEW_EVENT_APPEND_ONLY_' + action + '.log'), attempted.stdout + '\n' + attempted.stderr)
            assert event_bytes() == before
            state['denials'].append('owner_event_' + action)
        owner('update terra_correction_test_api.reviewer_scopes set enabled=false where principal=' + quote(reviewer) + ';', 'disable_review_scope')
        deny('disabled_replay', start, error='Invented correction reviewer scope refused')
        deny('disabled_status', sql='select terra_correction_test_api.read_review_status(' + quote(old_id) + '::uuid);', error='Invented correction reviewer scope refused')
        owner('update terra_correction_test_api.reviewer_scopes set enabled=true,expires_at=clock_timestamp()-interval \'1 second\' where principal=' + quote(reviewer) + ';', 'expire_review_scope')
        deny('expired_replay', finish, error='Invented correction reviewer scope refused')
        deny('expired_status', sql='select terra_correction_test_api.read_review_status(' + quote(old_id) + '::uuid);', error='Invented correction reviewer scope refused')
        state.update(statuses=statuses, completed=True)
        private_file(proof / 'ACTUAL_PRIVATE_REVIEW_STATUSES.json', json.dumps(statuses, indent=2) + '\n')
        private_file(proof / 'ACTUAL_PRIVATE_REVIEW_TRANSITIONS.json', json.dumps({'startRequest': start, 'startAfterCommit': start_receipt,
            'sameEventAfterCommit': repeated, 'closureRequest': finish, 'closureAfterUnconsumedCommit': closed_receipt,
            'currentStartRequest': current_start, 'currentStartAfterCommit': a_receipt}, indent=2) + '\n')

    def cleanup(owner):
        failures = []
        for selected in list(state['sessions']):
            try: close(selected)
            except BaseException as error: failures.append(type(error).__name__)
        for role, _password in state['roles']:
            try:
                exists = owner('select exists(select 1 from pg_roles where rolname=' + quote(role) + ');', 'review_role_exists_' + role, database='postgres')
                assert exists in ('t','f')
                if exists == 't':
                    sensitive_admin('alter role ' + role + ' nologin;')
                    assert owner('select rolcanlogin from pg_roles where rolname=' + quote(role) + ';', 'review_role_retired_' + role, database='postgres') == 'f'
            except BaseException as error: failures.append(type(error).__name__)
        state['roles'] = []
        if failures: raise RuntimeError('Invented reviewer cleanup requires retained-state inspection')

    with (fixed_trial_guard() if custody is None else custody.guard()):
        result = trial(projection_observer=observe, trial_cleanup=cleanup,
            owned_start_observer=None if custody is None else custody.before_start)
    assert state['completed']
    receipt = {'evidenceKind': 'actual_invented_correction_private_review', 'observedAt': datetime.now(timezone.utc).isoformat(),
        'candidateSha256': pins, 'privateReports': 4, 'requestReceipts': 4, 'reviewEvents': 3,
        'states': {'new': 2, 'in_review': 1, 'closed': 1}, 'statuses': state['statuses'], 'denials': state['denials'],
        'actualTypeScriptContractsChecked': True, 'duplicateEventLockWaitObserved': True, 'competingTransitionLockWaitObserved': True,
        'rollbackLeftNoEventOrStateChange': True, 'closureRecoveredAfterUnconsumedCommit': True,
        'historicalReceiptReplayDidNotReopenReport': True, 'historicalReviewDuringWithdrawnDisplayRights': True,
        'reportIdentityContentAndPublicationsUnchanged': True, 'eventsAppendOnly': True,
        'actualSourceRequests': 0, 'modelCalls': 0, 'realReports': 0, 'primaryChanged': False, 'liveReviewEnabled': False,
        'privacyPolicySelected': False, 'notificationSent': False, 'publicContentChangedByReports': False,
        'browserVerified': False, 'temporaryAccountsRetired': True, 'ownedCloneStopped': True,
        'privateEvidenceDirectory': result['privateEvidenceDirectory']}
    private_file(state['proof'] / 'CORRECTION_PRIVATE_REVIEW_RESULT.json', json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2)); return 0


if __name__ == '__main__': raise SystemExit(main())
