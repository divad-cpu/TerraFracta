"""Run a sealed private collector through a supplied scoped parent backend.

No CLI, account, target selection, source permission, schedule or publication.
The trusted caller must establish the operational source/retention/copy gates
and provide an owned bounded native process client. Invented
integration wrappers explicitly refuse original HTTP before using this module.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import socket
import threading
import time

from scripts.admit_private_ssb_collector import AdmittedPrivateCollectorLaunch
from workers.bounded_worker_process import communicate_bounded
from workers.bounded_native_client import BoundedNativeClient
from workers.closed_pair_channel import PairCustodianSession, _json
from workers.native_pair_custodian import NativePairCustodian
from workers.private_pair_native_backend import PrivatePairNativeBackend
from workers.ssb_frozen_private_collector import check_private_collector_source
from workers.ssb_private_collector_result import validate_private_collector_result
from workers.ssb_14059_private_assessment import build_first_private_ssb_assessment
from workers.ssb_pair_processing import PendingPairResult
from workers.update_run_completion import canonical_run_manifest


@dataclass(frozen=True)
class CheckedPrivateCollectorResult:
    pending: PendingPairResult
    worker_payload: dict
    held_assessment: dict
    processing_seconds: float
    native_admission_sha256: str
    checked_operations: tuple[str, ...]


def run_journaled_private_collector(source, backend, *, journal_directory,
        on_confirmed=None, utc_now=lambda:datetime.now(timezone.utc)):
    """One explicit private journal, acknowledged before any native admission.

    This opt-in parent connector selects no live source/account/root. Existing
    incomplete or finished evidence is never erased, repaired or reused. A
    terminal witness records local cleanup separately from remote write state.
    """
    from workers.private_admission_journal import record_private_admission
    from workers.private_custodian_journal import record_private_custodian_start, record_private_custodian_finish
    if type(backend) is not PrivatePairNativeBackend or type(backend.native_client) is not BoundedNativeClient \
            or not callable(utc_now) or (on_confirmed is not None and not callable(on_confirmed)):
        raise ValueError('Invalid journaled private collector configuration')
    client = backend.native_client
    if backend.closed or backend.admission is not None or backend.admission_receipt is not None \
            or backend.store_consumed or client.closed or client.active or client.calls:
        raise ValueError('Journaled private collector requires a fresh owned context')
    start = None; outcome = 'failed_held'
    try:
        start = record_private_custodian_start(journal_directory, backend.source_fingerprint,
            backend.raw_context, now=utc_now())
        result = run_admitted_private_collector(source, backend,
            on_admitted=lambda raw:record_private_admission(journal_directory, raw),
            on_confirmed=on_confirmed, utc_now=utc_now)
        if type(result) is not CheckedPrivateCollectorResult: raise ValueError
        outcome = 'pending_held'
        return result
    except BaseException as error:
        outcome = 'failed_held' if isinstance(error, Exception) else 'interrupted_held'
        if isinstance(error, Exception):
            raise ValueError('Journaled private collector unavailable; preserve existing evidence') from None
        raise
    finally:
        try:
            client.cancel(); backend.closed = True
            confirmed = client.confirm_cleanup()
            if start is not None:
                record_private_custodian_finish(journal_directory, start, backend.admission_receipt,
                    backend, outcome=outcome if confirmed else 'failed_held', now=utc_now())
        except Exception:
            raise ValueError('Private custodian terminal observation unavailable; preserve existing evidence') from None
        if not confirmed: raise RuntimeError('Private native process cleanup is not confirmed')


def run_admitted_private_collector(source, backend, *, on_admitted, on_confirmed=None,
        utc_now=lambda:datetime.now(timezone.utc)):
    if type(backend) is not PrivatePairNativeBackend or not callable(utc_now) \
            or type(backend.native_client) is not BoundedNativeClient \
            or (on_confirmed is not None and not callable(on_confirmed)) \
            or not callable(on_admitted):
        raise ValueError('Invalid private collector custodian configuration')
    try:
        return _run_owned_private_collector(source,backend,on_confirmed=on_confirmed,
            on_admitted=on_admitted,utc_now=utc_now)
    finally:
        # Cover every startup edge, including source checks, admission, socket
        # creation and thread creation before a worker can exist.
        backend.native_client.cancel()
        backend.closed=True
        if not backend.native_client.confirm_cleanup():
            raise RuntimeError('Private native process cleanup is not confirmed')


def _run_owned_private_collector(source, backend, *, on_confirmed, on_admitted, utc_now):
    check_private_collector_source(source)
    if backend.source_fingerprint != source.source_fingerprint:
        raise ValueError('Private collector differs from native backend source pin')
    admission = backend.confirm_admission()
    # Preserve and reopen admission before worker startup. An acknowledgement
    # alone is insufficient: it must match the exact independently read record.
    if on_admitted(backend.admission_receipt)!=backend.admission_receipt:
        raise ValueError('Private admission journal readback differs')
    context = admission.context
    launch = AdmittedPrivateCollectorLaunch(source, backend.raw_context, metadata=context.metadata,
        data=context.data, versions={'metadata':context.metadata_version_id,'data':context.data_version_id},
        pair_id=context.pair_id, principal=context.principal, now=utc_now())
    custodian = NativePairCustodian(backend.raw_context,backend.execute_once,
        utc_now=utc_now,on_confirmed=on_confirmed)
    failures=[];worker=None;thread=None;started=time.monotonic();output=None
    parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
    with parent,child:
        session=PairCustodianSession(custodian.operations(),time.monotonic()+20)
        def serve():
            try:
                for _ in range(16):
                    if session.serve_one(parent)!='receipt':break
            except BaseException as error:
                failures.append(type(error).__name__)
        thread=threading.Thread(target=serve,name='private-native-custodian')
        thread.start()
        try:
            worker=launch.start(child);child.close()
            output=communicate_bounded(worker,backend.raw_context,timeout=20)
        finally:
            try:
                if worker is not None and worker.poll() is None:
                    try:worker.kill()
                    except ProcessLookupError:pass
                    worker.wait(timeout=5)
            finally:
                # A failed worker cleanup must still cancel the native process
                # and wake the owned channel reader. Never drain unrestricted
                # output through a second communicate() call during cleanup.
                if worker is not None:
                    for name in ('stdin','stdout','stderr'):
                        stream=getattr(worker,name,None)
                        if stream is not None and not stream.closed:
                            try:stream.close()
                            except OSError:pass
                # If spawn failed, this parent still owns the channel's peer.
                # Close it before joining: EOF also wakes the reader when the
                # environment refuses shutdown(). No live worker owns it now.
                child.close()
                try:parent.shutdown(socket.SHUT_RDWR)
                except OSError:pass
                backend.native_client.cancel()
                # Cancellation never implies SQL rollback; raw files and
                # possible committed rows remain recovery evidence.
                thread.join(timeout=6)
                backend.closed=True
                if thread.is_alive() or not backend.native_client.confirm_cleanup():
                    raise RuntimeError('Private native process cleanup is not confirmed')
    if output is None or output.returncode or output.stderr or not 2<=len(output.stdout)<=16384 \
            or custodian.stored_context is None or backend.raw_expected is None \
            or backend.raw_binding_receipt is None or backend.raw_reconciliation is None:
        raise ValueError('Private collector has no confirmed terminal outcome')
    payload=_json(output.stdout)
    validate_private_collector_result(payload,expected_launch_receipt=launch.receipt(),
        canonical=canonical_run_manifest(custodian.stored_context.manifest),calls=custodian.calls,
        failures=failures,committed_times=custodian.committed_times,committed_receipts=custodian.committed_receipts)
    reread=backend.custody.read(backend.raw_expected.attempt_id,now=utc_now())
    assessment=build_first_private_ssb_assessment(reread.metadata_response,reread.data_response,
        backend.raw_expected,pair_id=context.pair_id,
        versions={'metadata':context.metadata_version_id,'data':context.data_version_id},now=utc_now())
    return CheckedPrivateCollectorResult(PendingPairResult(custodian.stored_context,context.pair_id,custodian.closeout),
        payload,assessment,time.monotonic()-started,
        admission.receipt_sha256,tuple(custodian.calls))
