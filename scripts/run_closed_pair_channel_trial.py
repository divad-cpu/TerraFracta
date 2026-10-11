"""Actual paired fixture capture from a separate credential-free worker.

Reuse the existing owned isolated SCRAM trial. Only the parent custodian has a
native database client; child requests are bounded closed-channel operations.
No primary, raw retention, HTTP source or public writer is enabled.
"""
import base64
from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from re import fullmatch
import socket
import subprocess
import sys
import threading
import time

from scripts.captured_fictional_pipeline import ROOT, private_file
from scripts.check_run_admission_concurrency import quote
from scripts.build_fictional_ssb_pair_api import SCHEMA
from workers.closed_pair_channel import FIELDS, PairCustodianSession, _binary, _json, validate_operation
from workers.committed_pair_result import validate_committed_pair_bytes
from workers.bounded_worker_process import communicate_bounded
from workers.ssb_14059_batch import assemble_private_ssb_14059_batch
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL, parse_captured_ssb_14059, parse_captured_ssb_14059_metadata
from workers.ssb_14059_context_manifest import build_ssb_context_manifest
from workers.reserved_response_capture import ReservedCapture
from workers.reserved_ssb_capture import ReservedSSBResponse
from workers.source_response_receipts import parse_response_reservation, parse_response_dispatch, parse_response_settlement
from workers.ssb_14059_context_manifest import SSBContextManifest
from workers.ssb_pair_processing import PendingPairResult, require_pending_pair_checkpoint
from workers.update_run_completion import parse_canonical_run_manifest, reconcile_run_completion
from workers.update_run_closeout import parse_run_closeout
from workers.pair_native_sql import operation_sql
from workers.ssb_store_capture_validation import validate_store_capture
from workers.native_pair_custodian import NativePairCustodian


def validate_committed_worker_result(payload, *, canonical, calls, failures, committed_times, committed_receipts, expected_launch_receipt=None):
    """Bind worker output to exact evidence the custodian actually observed."""
    expected_fields = {'schemaVersion', 'fixtureReads', 'canonicalManifest', 'metadataRetrievedAt', 'dataRetrievedAt',
        'checkpoint', 'closeout', 'operations', 'credentialEnvironmentPresent', 'actualSourceRequests', 'databaseClientPresent', 'transactionControlProbeRefused'}
    if expected_launch_receipt is not None:
        expected_fields.add('launchReceipt')
        if type(payload) is not dict:
            raise ValueError('Frozen worker launch receipt disagrees')
        receipt = payload.get('launchReceipt')
        receipt_fields = {'schemaVersion', 'sourceFingerprint', 'archiveSha256', 'contextSha256',
                          'sealedSource', 'sealedTransportChildren', 'repositoryCodeReopened'}
        if type(receipt) is not dict or set(receipt) != receipt_fields \
                or type(receipt['schemaVersion']) is not int or receipt['schemaVersion'] != 1 \
                or receipt['sealedSource'] is not True or receipt['repositoryCodeReopened'] is not False \
                or type(receipt['sealedTransportChildren']) is not int or receipt['sealedTransportChildren'] != 2 \
                or any(type(receipt[name]) is not str or fullmatch('[0-9a-f]{64}', receipt[name]) is None
                       for name in ('sourceFingerprint', 'archiveSha256', 'contextSha256')) \
                or receipt != expected_launch_receipt:
            raise ValueError('Frozen worker launch receipt disagrees')
    if type(payload) is not dict or set(payload) != expected_fields or type(payload['schemaVersion']) is not int or payload['schemaVersion'] != 1 \
            or payload['fixtureReads'] != ['metadata', 'data'] or payload['canonicalManifest'] != canonical \
            or type(payload['operations']) is not int or payload['operations'] != 16 or len(calls) != 16 or failures \
            or payload['credentialEnvironmentPresent'] is not False or payload['databaseClientPresent'] is not False \
            or type(payload['actualSourceRequests']) is not int or payload['actualSourceRequests'] != 0 or payload['transactionControlProbeRefused'] is not True:
        raise ValueError('Separate private fixture worker result disagrees')
    # A worker's result cannot substitute retrieved times or fabricate a
    # post-COMMIT receipt. Compare exact bytes from the trusted native callback.
    validate_committed_pair_bytes(payload,canonical=canonical,calls=calls,failures=failures,
        committed_times=committed_times,committed_receipts=committed_receipts)


def persist_checked_worker_output(proof, output, **custodian_evidence):
    """Write only closed output already matched to trusted native evidence."""
    if output.returncode != 0 or output.stderr or not 2 <= len(output.stdout) <= 16384:
        raise ValueError('Separate private fixture worker failed')
    payload = _json(output.stdout)
    validate_committed_worker_result(payload, **custodian_evidence)
    private_file(proof/'CLOSED_WORKER_STDOUT.json', output.stdout.decode('utf-8'))
    private_file(proof/'CLOSED_WORKER_STDERR.log', '')
    return payload



def run_worker(requests, versions, pair_id, principal, native_client, proof, canonical, fixture_reads, *, cancel_after_metadata=False, operation_interceptor=None, transport_children=False, transport_fault=None, frozen_source=None, private_collector_source=None):
    from scripts.run_authenticated_ssb_pair_capture import fixture_body
    if type(transport_children) is not bool or transport_fault not in (None, 'invalid_metadata', 'invalid_data') or (transport_fault is not None and not transport_children):
        raise ValueError('Invalid fixed fictional worker selection')
    if frozen_source is not None and (not transport_children or transport_fault is not None):
        raise ValueError('Frozen worker requires its fixed invented transport')
    if private_collector_source is not None:
        if frozen_source is not None or not transport_children or transport_fault is not None:
            raise ValueError('Private wiring requires its own fixed invented transport')
        from scripts.private_collector_wiring_source import check_private_wiring_source
        check_private_wiring_source(private_collector_source)
    child_module = 'scripts.paired_transport_fixture_child' if transport_children else 'scripts.paired_channel_fixture_child'
    if transport_fault is not None:
        child_module = 'scripts.paired_transport_fault_fixture_child'
    context = {'request': asdict(requests['metadata'].invocation), 'work': asdict(requests['metadata'].work),
        'responses': {kind: {'registration_id': req.registration_id, 'request_key': req.request_key} for kind, req in requests.items()},
        'versions': versions, 'pairId': pair_id, 'principal': principal}
    encoded = json.dumps(context, default=str, separators=(',', ':'))
    launch = None
    if frozen_source is not None:
        from scripts.admit_frozen_ssb_launch import AdmittedFrozenFixtureLaunch
        launch = AdmittedFrozenFixtureLaunch(frozen_source, encoded.encode('utf-8'),
            metadata=requests['metadata'], data=requests['data'], versions=versions,
            pair_id=pair_id, principal=principal)
        private_file(proof/'FROZEN_LAUNCH_BINDING.json', json.dumps(launch.receipt(), indent=2)+'\n')
    elif private_collector_source is not None:
        from scripts.admit_private_ssb_collector import AdmittedPrivateCollectorLaunch
        launch=AdmittedPrivateCollectorLaunch(private_collector_source,encoded.encode('utf-8'),
            metadata=requests['metadata'],data=requests['data'],versions=versions,pair_id=pair_id,principal=principal)
        private_file(proof/'PRIVATE_COLLECTOR_LAUNCH_BINDING.json',json.dumps(launch.receipt(),indent=2)+'\n')
    failures = []
    def execute_once(operation, arguments):
        sql = operation_sql(operation, arguments)
        response = native_client(sql) if operation_interceptor is None else operation_interceptor(operation,arguments,sql,native_client)
        if response.returncode:
            # PostgreSQL errors can echo statement lines containing encoded
            # source bytes. Do not create a second unbounded-retention copy.
            from scripts.private_diagnostic_redaction import closed_native_refusal_record
            private_file(proof/('CUSTODIAN_NATIVE_REFUSAL_'+operation+'.json'),
                         closed_native_refusal_record(operation,response))
            raise ValueError('Fixed custodian operation refused')
        return response.stdout.strip().encode('utf-8')
    def on_confirmed(operation, arguments, raw):
        # Only committed fixture receipts are logged, never command or credentials.
        private_file(proof / ('CHANNEL_' + str(len(calls)).zfill(3) + '_' + operation + '.json'), raw.decode('utf-8') + '\n')
        if cancel_after_metadata and operation == 'settle_response' and arguments['kind'] == 'metadata':
            if worker is None or worker.poll() is not None:
                raise ValueError('Owned fixture worker ended before cancellation probe')
            # Signal only the exact child this custodian started, after the
            # actual measured database COMMIT and before reply/confirmation.
            worker.terminate()
            private_file(proof / 'OWNED_WORKER_CANCELLED.json', json.dumps({
                'phase': 'after_metadata_settlement_commit', 'signal': 'SIGTERM',
                'onlyOwnedChildSignalled': True, 'actualSourceRequests': 0}) + '\n')
    custodian = NativePairCustodian(encoded.encode('utf-8'), execute_once, on_confirmed=on_confirmed)
    calls = custodian.calls
    committed_receipts = custodian.committed_receipts
    committed_times = custodian.committed_times
    operations = custodian.operations()
    parent, child_socket = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    worker = None
    thread = None
    with parent, child_socket:
        session = PairCustodianSession(operations, time.monotonic() + 20)
        def serve():
            try:
                # Private wiring ends after sixteen confirmed operations. The
                # older invented entry sends a seventeenth negative probe.
                for _ in range(16 if private_collector_source is not None else 17):
                    if session.serve_one(parent) != 'receipt':
                        break
            except BaseException as error:
                failures.append(type(error).__name__)
        thread = threading.Thread(target=serve, name='paired-fixture-custodian')
        thread.start()
        try:
            if launch is not None:
                worker = launch.start(child_socket)
            else:
                worker = subprocess.Popen([sys.executable, '-m', child_module, str(child_socket.fileno()), *([] if transport_fault is None else [transport_fault])],
                    cwd=ROOT, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'},
                    pass_fds=(child_socket.fileno(),), close_fds=True,
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            child_socket.close()
            output = communicate_bounded(worker, encoded.encode('utf-8'), timeout=20)
            private_file(proof/'CLOSED_WORKER_PROCESS_RESULT.json', json.dumps({
                'exitCode': output.returncode, 'stdoutBytes': len(output.stdout),
                'stderrBytes': len(output.stderr), 'uncheckedOutputRetained': False})+'\n')
            if output.returncode or output.stderr:
                error=ValueError('Separate private fixture worker failed')
                error.private_evidence_directory=proof
                raise error
        finally:
            if worker is not None and worker.poll() is None:
                worker.kill()
                worker.communicate(timeout=5)
            parent.shutdown(socket.SHUT_RDWR)
            thread.join(timeout=17)
            if thread.is_alive():
                raise RuntimeError('Private custodian failed to end')
            private_file(proof/'CUSTODIAN_TERMINAL_STATE.json',json.dumps({'checkedOperations':len(calls),
                'failureTypes':failures,'privateWiringTerminalPackets':16 if private_collector_source is not None else 17,
                'rawBodiesLogged':False,'credentialOutputIncluded':False})+'\n')
    if private_collector_source is None:
        payload = persist_checked_worker_output(proof, output, canonical=canonical, calls=calls, failures=failures,
            committed_times=committed_times, committed_receipts=committed_receipts,
            expected_launch_receipt=None if launch is None else launch.receipt())
    else:
        from workers.ssb_private_collector_result import validate_private_collector_result
        if output.returncode or output.stderr or not 2<=len(output.stdout)<=16384:
            raise ValueError('Private wiring worker failed')
        payload=_json(output.stdout)
        validate_private_collector_result(payload,canonical=canonical,calls=calls,failures=failures,
            committed_times=committed_times,committed_receipts=committed_receipts,expected_launch_receipt=launch.receipt())
        private_file(proof/'PRIVATE_COLLECTOR_WORKER_STDOUT.json',output.stdout.decode('utf-8'))
    manifest = parse_canonical_run_manifest(canonical.encode())
    metadata_at, data_at = (datetime.fromisoformat(payload[k]) for k in ('metadataRetrievedAt', 'dataRetrievedAt'))
    bodies = {kind: fixture_body(kind) for kind in ('metadata', 'data')}
    batch = assemble_private_ssb_14059_batch(
        previous_accepted_data=None,
        metadata_response=CapturedResponse(METADATA_URL, METADATA_URL, 0, 200, 'application/json', bodies['metadata'], metadata_at),
        data_response=CapturedResponse(DATA_URL, DATA_URL, 0, 200, 'application/json', bodies['data'], data_at))
    paired = SSBContextManifest(manifest, 'ssb-14059', requests['metadata'].registration_id,
        requests['data'].registration_id, metadata_at, data_at, len(bodies['metadata']), len(bodies['data']), batch.attention_reasons)
    checkpoint = _binary(payload['checkpoint'], 32768)
    require_pending_pair_checkpoint(checkpoint, paired, pair_id, str(requests['metadata'].work.lease_id))
    now = datetime.now(timezone.utc)
    expected = reconcile_run_completion(manifest, (), (), (), now=now)
    closeout = parse_run_closeout(_binary(payload['closeout'], 32768), manifest,
        str(requests['metadata'].work.lease_id), expected, started_at=requests['metadata'].work.observed_at, now=now)
    fixture_reads.extend(payload['fixtureReads'] if private_collector_source is None else payload['responseKinds'])
    private_file(proof / 'CLOSED_WORKER_BOUNDARY.json', json.dumps({'operations': calls,
        'childHasDatabaseCredentials': False, 'childHasDatabaseClient': False,
        'childUsesOwnerSql': False, 'childAcceptsTransactionControl': False, 'actualTransactionControlProbeRefused': private_collector_source is None,
        'actualChildProcess': True, 'boundedFictionalTransportChildren': 2 if transport_children else 0, 'actualSourceRequests': 0, 'osHostileCodeSandbox': False,
        'generalSqlTimingAccepted': False}, indent=2) + '\n')
    return PendingPairResult(paired, pair_id, closeout)


def main():
    if sys.argv[1:]:
        raise RuntimeError('Fixed closed-worker trial accepts no arguments')
    from scripts.fictional_trial_guard import fixed_trial_guard
    from scripts.run_authenticated_ssb_pair_capture import _run_trial
    with fixed_trial_guard():
        result = _run_trial('nominal', runtime_runner=run_worker)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
