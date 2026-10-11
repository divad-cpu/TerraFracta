"""One fixed integration package; invented transport, native writes and restart.

Uses the existing scoped SCRAM/raw trial. No original HTTP, primary migration,
live root selection, schedule, publication or CLI selector is available.
"""
from datetime import datetime, timezone
import json
import os
import secrets
import subprocess
import sys

from scripts.captured_fictional_pipeline import private_file, ROOT
from scripts.run_private_custodian_trial import PRIVATE, run_fixed_custodian_trial
from workers.bounded_worker_process import communicate_bounded


def reopen_recovery(raw):
    if type(raw) is not bytes or not 2 <= len(raw) <= 4096:
        raise ValueError('Fixed recovery request is outside its input bound')
    child = subprocess.Popen((sys.executable, '-B', '-E', '-s', '-m',
        'scripts.check_journaled_guarded_trial_recovery'), cwd=ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True)
    return communicate_bounded(child, raw, timeout=30, max_input=4096,
        max_stdout=32768, max_stderr=2048)


def main():
    if sys.argv[1:]: raise RuntimeError('Fixed journaled guarded trial accepts no arguments')
    os.umask(0o077)
    proof = PRIVATE/('journaled-guarded-integration-' + datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
        + '_' + secrets.token_hex(3))
    proof.mkdir(mode=0o700)
    results = []
    cases = (
        ('retained_nominal', {'transactional_store': True}),
        ('store_receipt_lost', {'fault': 'store_receipt_lost'}),
        ('journal_finish_receipt_lost', {'fault': 'journal_finish_receipt_lost'}),
        ('owned_cancellation', {'cancel_before_metadata_read': True}),
    )
    try:
        for label, options in cases:
            result = run_fixed_custodian_trial(journaled_guarded=True, **options)
            private_file(proof/(label+'.json'), json.dumps(result, indent=2)+'\n')
            results.append({'case': label, **result})
        request = {'schemaVersion': 1, 'cases': [{'case': item['case'],
            'privateEvidenceDirectory': item['privateEvidenceDirectory']} for item in results]}
        raw = json.dumps(request, separators=(',', ':')).encode('ascii')
        private_file(proof/'RECOVERY_INPUT.json', raw.decode('ascii')+'\n')
        # A new interpreter reopens actual journal/custody files. It receives no
        # password or inherited runtime account and performs read-only SQL.
        reopened = reopen_recovery(raw)
        private_file(proof/'RECOVERY_STDOUT.json', reopened.stdout.decode('utf-8'))
        private_file(proof/'RECOVERY_STDERR.log', reopened.stderr.decode('utf-8'))
        if reopened.returncode: raise RuntimeError('Fresh-process journaled recovery refused')
        recovery = json.loads(reopened.stdout)
        result = {'evidenceKind': 'actual_invented_journaled_guarded_integration',
            'observedAt': datetime.now(timezone.utc).isoformat(), 'trials': results, 'recovery': recovery,
            'actualSourceRequests': 0, 'originalHttpModuleExecuted': False,
            'primaryChanged': False, 'publicationEnabled': False, 'scheduleEnabled': False,
            'creatingParentGuardTargetsLocalDockerCli': True, 'remoteRollbackAttested': False}
        private_file(proof/'RESULT.json', json.dumps(result, indent=2)+'\n')
        print(json.dumps({'privateEvidenceDirectory': str(proof), **result}, indent=2))
    except BaseException as error:
        private_file(proof/'FAILED.json', json.dumps({'exceptionType': type(error).__name__,
            'completedCases': [item['case'] for item in results], 'sourceRequests': 0,
            'historicalEvidencePreserved': True, 'writeReplayed': False})+'\n')
        raise


if __name__ == '__main__': main()
