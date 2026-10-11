"""Actual fixed invented request retries and two ordinary concurrent clients.

Reuses the closed successor driver and unchanged v2 correction candidate in a
fresh fictional database. New principals receive ONLY submit_request. Retains
all actual evidence; no primary, network, real reports or privacy-policy choice.
"""
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import secrets
import sys
import time

from scripts import check_invented_correction_intake as intake
from scripts.captured_fictional_pipeline import ROOT, REG, private_file
from scripts.check_authenticated_capture_pipeline import command, sensitive_admin
from scripts.check_machine_activation_concurrency import Session
from scripts.check_run_admission_concurrency import quote
from scripts.fictional_trial_guard import fixed_trial_guard
from scripts.run_authenticated_successor_pipeline import trial

RELIABILITY = ROOT / 'research/pending/TF007_invented_correction_reliability.sql'
REQUEST_IDS = {
    'first': ('f8a10111-1111-4111-8111-111111111111', 'f8a11111-1111-4111-8111-111111111111'),
    'successor': ('f8a20111-1111-4111-8111-111111111111', 'f8a21111-1111-4111-8111-111111111111'),
}


def request_wire(projection):
    result = command(['node', '--experimental-strip-types', 'scripts/build_invented_correction_request_wire.mjs'],
                     data=json.dumps(projection), timeout=5)
    if result.returncode or len(result.stdout.encode()) > 16384:
        raise ValueError('Fixed invented request wire refused')
    wire = json.loads(result.stdout)
    phase = 'first' if projection['revision'] == 1 else 'successor'
    if set(wire) != {'schemaVersion', 'evidenceKind', 'requests', 'sourceRequests', 'realReports', 'submissionEnabled'} \
            or type(wire['schemaVersion']) is not int or wire['schemaVersion'] != 1 \
            or wire['evidenceKind'] != 'checked_invented_correction_request_wire' \
            or type(wire['sourceRequests']) is not int or wire['sourceRequests'] != 0 \
            or type(wire['realReports']) is not int or wire['realReports'] != 0 \
            or wire['submissionEnabled'] is not False or len(wire['requests']) != 2:
        raise ValueError('Invented request wire contract differs')
    for index, request in enumerate(wire['requests']):
        target = {key: projection[key] for key in ('issueId', 'publicationId', 'revision', 'jurisdictionSlug', 'issueSlug')}
        target['claimId'] = projection['claims'][0]['id'] if index == 0 else None
        expected = {'schemaVersion': 1, 'requestId': REQUEST_IDS[phase][index], 'draft': {'target': target, 'fields': intake.FIELDS}}
        if request != expected: raise ValueError('Invented request target differs')
    return wire


def submit_sql(request):
    return 'select terra_correction_test_api.submit_request(' + quote(json.dumps(request)) + '::jsonb);'


def main():
    if sys.argv[1:]: raise ValueError('Fixed invented request trial accepts no arguments')
    candidates = {path: path.read_bytes() for path in (intake.CANDIDATE, RELIABILITY)}
    pins = {path.name: sha256(body).hexdigest() for path, body in candidates.items()}
    assert pins[intake.CANDIDATE.name] == 'f429be4fff02b48d07b841d2bc568b24d45f09e945b9ac64eab1b0597fd8953b'
    state = {'phases': [], 'roles': [], 'sessions': [], 'reports': 0}

    def session(role, password, database):
        selected = Session(intake.client_args(role, database))
        state['sessions'].append(selected)  # Own before credential delivery.
        selected.process.stdin.write(password + '\n'); selected.process.stdin.flush()
        return selected

    def close(selected):
        selected.close(); state['sessions'].remove(selected)

    def wait(owner, sql, label):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if owner(sql, label) == 't': return
            time.sleep(.025)
        raise ValueError('Exact invented request commit or lock wait not observed')

    def observe(phase, projection, database, proof, owner):
        if any(path.read_bytes() != body for path, body in candidates.items()):
            raise ValueError('Correction candidate changed during trial')
        state.update(proof=proof, database=database)
        if phase == 'first':
            for path, body in candidates.items(): private_file(proof / ('EXACT_' + path.name), body.decode())
            owner('begin;' + ''.join(body.decode() for body in candidates.values()) + 'commit;', 'correction_reliability_candidate')
        wire = request_wire(projection)
        private_file(proof / (phase + '-ACTUAL_REQUEST_WIRE.json'), json.dumps(wire, indent=2) + '\n')
        suffix = proof.name.removeprefix('authenticated-successor-')
        role = 'terra_correction_' + phase + '_' + suffix
        password = secrets.token_urlsafe(48)
        state['roles'].append((role, password))  # Register attempted CREATE before I/O.
        sensitive_admin('create role ' + role + ' login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 2 password ' + quote(password) + ';')
        owner('insert into terra_correction_test_api.principal_scopes values(' + quote(role) + ',' + quote(projection['issueId']) +
              ",clock_timestamp()+interval '5 minutes',true,encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex'));grant usage on schema terra_correction_test_api to " + role +
              ';grant execute on function terra_correction_test_api.submit_request(jsonb) to ' + role + ';', phase + '_request_scope')
        denials = []
        def call(request): return intake.client(role, password, database, submit_sql(request))
        def deny(label, request=None, sql=None, error=None):
            before = owner('select count(*) from terra_private.correction_reports;', phase + '_' + label + '_before')
            result = intake.client(role, password, database, sql) if sql is not None else call(request)
            if result.returncode == 0 or error is not None and error not in result.stderr:
                raise ValueError('Expected invented request refusal differs: ' + label)
            after = owner('select count(*) from terra_private.correction_reports;', phase + '_' + label + '_after')
            if before != after: raise ValueError('Refused request changed report count')
            private_file(proof / (phase + '-REQUEST_DENIED-' + label + '.json'), json.dumps({'refused': True, 'reportsUnchanged': True}) + '\n')
            denials.append(label)
        for label, sql in (
            ('private_read', 'select * from terra_private.correction_reports;'),
            ('receipt_read', 'select * from terra_correction_test_api.request_receipts;'),
            ('scope_update', 'update terra_correction_test_api.principal_scopes set enabled=true;'),
            ('legacy_budget_bypass', 'select terra_correction_test_api.submit_report(\'{}\'::jsonb,\'{}\'::jsonb);'),
            ('review_assignment', "update terra_private.correction_reports set review_state='closed';"),
            ('receipt_delete', 'delete from terra_correction_test_api.request_receipts;'),
            ('owner_role', 'set role postgres;'),
        ): deny(label, sql=sql)
        for denied_role in ('anon','authenticated','service_role','terra_collector','terra_operator','terra_reviewer','terra_issue_reader'):
            assert owner('select has_function_privilege(' + quote(denied_role) + ",'terra_correction_test_api.submit_request(jsonb)','execute');", phase + '_request_grant_' + denied_role) == 'f'
        selected = wire['requests'][0]
        rolled_back = intake.client(role, password, database, 'begin;' + submit_sql(selected) + 'rollback;')
        assert rolled_back.returncode == 0
        assert owner('select count(*) from terra_private.correction_reports;', phase + '_rollback_report_count') == str(state['reports'])
        assert owner('select count(*) from terra_correction_test_api.request_receipts;', phase + '_rollback_receipt_count') == str(state['reports'])
        private_file(proof / (phase + '-ROLLED_BACK_REQUEST.json'), json.dumps({'provisionalReceiptAccepted': False, 'reportAndReceiptRolledBack': True}) + '\n')
        a = session(role, password, database); b = session(role, password, database)
        a_pid = int(a.execute('select pg_backend_pid();', 'FIRSTPID')[0])
        b_pid = int(b.execute('select pg_backend_pid();', 'SECONDPID')[0])
        first = json.loads(a.execute('begin;' + submit_sql(selected), 'PROVISIONAL')[0])
        assert first['replayed'] is False
        b.send('begin;' + submit_sql(selected), 'DUPLICATE')
        wait(owner, 'select ' + str(a_pid) + '=any(pg_blocking_pids(' + str(b_pid) + '));', phase + '_duplicate_block')
        assert owner('select count(*) from terra_private.correction_reports;', phase + '_uncommitted_count') == str(state['reports'])
        a.execute('commit;', 'FIRSTCOMMITTED')
        repeated = json.loads(b.until('DUPLICATE')[0]); b.execute('commit;', 'SECONDCOMMITTED')
        assert repeated == {**first, 'replayed': True}
        close(a); close(b)
        state['reports'] += 1
        private_file(proof / (phase + '-ACTUAL_DUPLICATE_RECEIPTS.json'), json.dumps({'afterCommit': [first, repeated], 'actualBlockingPidsObserved': True}, indent=2) + '\n')

        # Deliberately do not consume the client's result. Confirm committed
        # state independently, disconnect it, then retry from another process.
        unconsumed = session(role, password, database)
        page = wire['requests'][1]
        unconsumed_pid = int(unconsumed.execute('select pg_backend_pid();', 'UNCONSUMEDPID')[0])
        unconsumed.send('begin;' + submit_sql(page), 'UNCONSUMEDRECEIPT')
        wait(owner, "select exists(select 1 from pg_stat_activity where pid=" + str(unconsumed_pid) + " and state='idle in transaction');", phase + '_unconsumed_transaction_ready')
        budget_competitor = session(role, password, database)
        competitor_pid = int(budget_competitor.execute('select pg_backend_pid();', 'BUDGETPID')[0])
        third = {**selected, 'requestId': 'f8a33333-3333-4333-8333-333333333333'}
        budget_competitor.send('begin;' + submit_sql(third), 'BUDGETCOMPETITOR')
        wait(owner, 'select ' + str(unconsumed_pid) + '=any(pg_blocking_pids(' + str(competitor_pid) + '));', phase + '_last_slot_block')
        unconsumed.send('commit;', 'UNCONSUMEDCOMMIT')
        wait(owner, 'select exists(select 1 from terra_correction_test_api.request_receipts where principal=' + quote(role) + ' and request_id=' + quote(page['requestId']) + ');', phase + '_unconsumed_commit')
        close(unconsumed)
        try: budget_competitor.until('BUDGETCOMPETITOR')
        except RuntimeError:
            budget_competitor.process.wait(timeout=5)
            assert budget_competitor.process.returncode != 0
            assert any('Invented correction request budget exceeded' in line for line in budget_competitor.errors)
        else: raise ValueError('Concurrent request exceeded the fixed last-slot budget')
        close(budget_competitor)
        recovered = call(page); assert recovered.returncode == 0
        recovered_receipt = json.loads(recovered.stdout); assert recovered_receipt['replayed'] is True
        expected_id = owner('select report_id from terra_correction_test_api.request_receipts where principal=' + quote(role) + ' and request_id=' + quote(page['requestId']) + ';', phase + '_unconsumed_report_id')
        assert recovered_receipt['reportId'] == expected_id
        state['reports'] += 1
        private_file(proof / (phase + '-UNCONSUMED_COMMIT_RECOVERY.json'), json.dumps({'firstResultConsumed': False, 'committedRowObservedIndependently': True, 'recoveredReceipt': recovered_receipt}, indent=2) + '\n')
        deny('budget_exceeded', third, error='Invented correction request budget exceeded')
        replay_at_cap = call(selected); assert replay_at_cap.returncode == 0
        assert json.loads(replay_at_cap.stdout) == repeated
        conflict = deepcopy(selected); conflict['draft']['fields']['details'] = 'A different invented explanation for this key.'
        deny('same_key_conflict', conflict, error='Invented correction request conflicts')
        for label, changed in (
            ('extra_authority', {**selected, 'reviewState': 'closed'}),
            ('malformed_id', {**selected, 'requestId': 'not-a-uuid'}),
            ('uppercase_id', {**selected, 'requestId': selected['requestId'].upper()}),
            ('null_request', None),
            ('missing_draft', {k:v for k,v in selected.items() if k != 'draft'}),
            ('boolean_version', {**selected, 'schemaVersion': True}),
            ('uuid_version_outside_contract', {**selected, 'requestId': 'f8a11111-1111-9111-8111-111111111111'}),
            ('uuid_variant_outside_contract', {**selected, 'requestId': 'f8a11111-1111-4111-0111-111111111111'}),
        ): deny(label, changed, error='Invented correction request refused' if label.startswith('uuid_') else None)
        for label, valid_id in (('nil_uuid_at_cap','00000000-0000-0000-0000-000000000000'),
                                ('max_uuid_at_cap','ffffffff-ffff-ffff-ffff-ffffffffffff')):
            deny(label, {**selected, 'requestId': valid_id}, error='Invented correction request budget exceeded')
        deny('repeatable_read', sql='begin isolation level repeatable read;' + submit_sql(selected), error='Invented correction isolation refused')
        expected_pin = owner('select expected_candidate_sha256 from terra_correction_test_api.principal_scopes where principal=' + quote(role) + ';', phase + '_original_request_pin')
        owner('update terra_correction_test_api.principal_scopes set expected_candidate_sha256=' + quote('0' * 64) + ' where principal=' + quote(role) + ';', phase + '_wrong_request_pin')
        deny('replay_wrong_pin', selected, error='Invented correction target is unavailable or changed')
        owner('update terra_correction_test_api.principal_scopes set expected_candidate_sha256=' + quote(expected_pin) + ' where principal=' + quote(role) + ';', phase + '_restore_request_pin')
        owner('update terra_private.source_registrations set allow_public_derived=false where id=' + quote(REG) + ';', phase + '_withdraw_for_retry')
        owner("update terra_correction_test_api.principal_scopes set expected_candidate_sha256=encode(sha256(convert_to(terra_private.read_issue_candidate('fictional-country','fictional-share')::text,'UTF8')),'hex') where principal=" + quote(role) + ';', phase + '_pin_withdrawn_for_retry')
        deny('replay_withdrawn_with_matching_pin', selected, error='Invented correction target is unavailable or changed')
        owner('update terra_private.source_registrations set allow_public_derived=true where id=' + quote(REG) + ';update terra_correction_test_api.principal_scopes set expected_candidate_sha256=' + quote(expected_pin) + ' where principal=' + quote(role) + ';', phase + '_restore_fixture_after_retry')
        owner('update terra_correction_test_api.principal_scopes set enabled=false where principal=' + quote(role) + ';', phase + '_disable_request_scope')
        deny('replay_disabled_scope', selected, error='Invented correction principal refused')
        owner('update terra_correction_test_api.principal_scopes set enabled=true where principal=' + quote(role) + ';', phase + '_restore_request_scope')
        if phase == 'successor':
            previous = state['first_request']
            deny('stale_request_on_successor', previous, error='Invented correction target is unavailable or changed')
            old_role, old_password = state['roles'][0]
            owner('update terra_correction_test_api.principal_scopes set expected_candidate_sha256=' + quote(expected_pin) + ' where principal=' + quote(old_role) + ';', 'old_request_pin_now_current')
            old_replay = intake.client(old_role, old_password, database, submit_sql(previous))
            assert old_replay.returncode != 0 and 'Invented correction target is unavailable or changed' in old_replay.stderr
            denials.append('old_principal_replay_after_successor')
        else: state['first_request'] = selected
        if phase == 'successor':
            owner('update terra_correction_test_api.principal_scopes set expires_at=clock_timestamp()-interval \'1 second\' where principal=' + quote(role) + ';', phase + '_expire_request_scope')
            deny('replay_expired_scope', selected, error='Invented correction principal refused')
        assert owner('select count(*) from terra_private.correction_reports;', phase + '_final_request_reports') == str(state['reports'])
        assert owner('select count(*) from terra_correction_test_api.request_receipts;', phase + '_final_request_receipts') == str(state['reports'])
        assert owner("select bool_and(review_state='new' and reviewed_at is null and resolution_note is null) from terra_private.correction_reports;", phase + '_unchanged_request_review_state') == 't'
        state['phases'].append({'phase': phase, 'revision': projection['revision'], 'newReports': 2, 'concurrentDuplicateReturnedSameReport': True,
            'actualBlockingPidsObserved': True, 'retryAfterUnconsumedCommitRecovered': True, 'replayAtBudgetCapSucceeded': True,
            'provisionalRollbackLeftNoReportOrReceipt': True, 'concurrentLastSlotLimitEnforced': True,
            'denials': denials, 'clientCanCallLegacyIntake': False, 'reviewStateChanged': False})

    def cleanup(owner):
        failures = []
        for selected in list(state['sessions']):
            try: close(selected)
            except BaseException as error: failures.append(type(error).__name__)
        for role, _password in state['roles']:
            try:
                exists = owner('select exists(select 1 from pg_roles where rolname=' + quote(role) + ');', 'request_role_exists_' + role, database='postgres')
                assert exists in ('t', 'f')
                if exists == 't':
                    sensitive_admin('alter role ' + role + ' nologin;')
                    assert owner('select rolcanlogin from pg_roles where rolname=' + quote(role) + ';', 'request_role_retired_' + role, database='postgres') == 'f'
            except BaseException as error: failures.append(type(error).__name__)
        state['roles'] = []
        if failures: raise RuntimeError('Invented request cleanup requires retained-state inspection')

    with fixed_trial_guard(): result = trial(projection_observer=observe, trial_cleanup=cleanup)
    proof = Path(result['privateEvidenceDirectory'])
    receipt = {'evidenceKind': 'actual_invented_correction_request_reliability', 'observedAt': datetime.now(timezone.utc).isoformat(),
        'candidateSha256': pins, 'phases': state['phases'], 'privateReports': state['reports'], 'requestReceipts': state['reports'],
        'actualSourceRequests': 0, 'modelCalls': 0, 'realReports': 0, 'primaryChanged': False, 'liveIntakeEnabled': False,
        'privacyPolicySelected': False, 'publicContentChangedByReports': False, 'browserVerified': False,
        'temporaryAccountsRetired': True, 'ownedCloneStopped': True, 'privateEvidenceDirectory': str(proof)}
    private_file(proof / 'CORRECTION_REQUEST_RELIABILITY_RESULT.json', json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2)); return 0


if __name__ == '__main__': raise SystemExit(main())
