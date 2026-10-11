"""Owned-process uncertainty without SQL, source, credentials or a live target."""
import io
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

from workers.bounded_native_client import BoundedNativeClient
from workers.bounded_worker_process import BoundedWorkerError, WorkerOutput
from workers.private_pair_native_sql import private_admission_sql
from workers.private_pair_native_backend import PrivatePairNativeBackend
from workers.private_collector_custodian import run_admitted_private_collector
from workers.retained_native_transaction import retained_pair_store


class UnconfirmedProcess:
    def __init__(self):
        self.stdin, self.stdout, self.stderr = io.BytesIO(), io.BytesIO(), io.BytesIO()
        self.returncode = None
        self.kills = 0

    def poll(self): return self.returncode
    def kill(self): self.kills += 1


class NativeClientCleanupStateTests(unittest.TestCase):
    def test_single_operation_retains_owned_handle_after_unconfirmed_cleanup(self):
        process = UnconfirmedProcess()
        client = BoundedNativeClient(('/bin/false',))
        with patch('workers.bounded_native_client.subprocess.Popen', return_value=process) as launch, \
                patch('workers.bounded_native_client.communicate_bounded', side_effect=BoundedWorkerError('Private process cleanup unavailable')):
            with self.assertRaises(ValueError): client(private_admission_sql())
            self.assertTrue(client.closed)
            self.assertTrue(client.active, 'An unconfirmed child must not be reported inactive')
            self.assertFalse(client.cleanup_confirmed)
            kills = process.kills
            self.assertFalse(client.confirm_cleanup())
            self.assertEqual(process.kills, kills, 'Confirmation must not send another termination signal')
            with self.assertRaises(ValueError): client(private_admission_sql())
            self.assertEqual(launch.call_count, 1)

    def test_retained_store_preserves_owned_handle_after_unconfirmed_cleanup(self):
        process = UnconfirmedProcess()
        client = BoundedNativeClient(('/bin/false',))
        with patch('workers.bounded_native_client.subprocess.Popen', return_value=process) as launch, \
                patch('workers.retained_native_transaction.retained_pair_store', side_effect=ValueError('Retained native cleanup unavailable')):
            with self.assertRaises(ValueError): client.store_pair_transaction(lambda _receipt: None)
            self.assertTrue(client.closed)
            self.assertTrue(client.active, 'Retained-store failure does not confirm local child exit')
            self.assertFalse(client.cleanup_confirmed)
            with self.assertRaises(ValueError): client.store_pair_transaction(lambda _receipt: None)
            self.assertEqual(launch.call_count, 1)

    def test_later_owned_exit_can_be_confirmed_without_sql_retry_or_reopening_client(self):
        process = UnconfirmedProcess(); client = BoundedNativeClient(('/bin/false',))
        with patch('workers.bounded_native_client.subprocess.Popen', return_value=process) as launch, \
                patch('workers.bounded_native_client.communicate_bounded', side_effect=BoundedWorkerError('Unconfirmed cleanup')):
            with self.assertRaises(ValueError): client(private_admission_sql())
            self.assertFalse(client.confirm_cleanup()); process.returncode = -9
            self.assertTrue(client.confirm_cleanup()); self.assertTrue(client.cleanup_confirmed)
            self.assertFalse(client.active); self.assertTrue(client.closed)
            with self.assertRaises(ValueError): client(private_admission_sql())
            self.assertEqual(launch.call_count, 1)

    def test_poll_or_signal_errors_are_private_and_retain_unknown_cleanup(self):
        for operation in ('poll', 'kill'):
            with self.subTest(operation=operation):
                process = UnconfirmedProcess(); client = BoundedNativeClient(('/bin/false',))
                with patch('workers.bounded_native_client.subprocess.Popen', return_value=process), \
                        patch('workers.bounded_native_client.communicate_bounded', side_effect=BoundedWorkerError('Unconfirmed cleanup')), \
                        patch.object(process, operation, side_effect=OSError('private-operation-canary')):
                    with self.assertRaises(ValueError) as error: client(private_admission_sql())
                    self.assertNotIn('canary', str(error.exception)); self.assertTrue(client.active)
                    self.assertFalse(client.confirm_cleanup()); self.assertFalse(client.cleanup_confirmed)
                    client.cancel(); self.assertTrue(client.closed)

    def test_confirmation_during_inflight_io_cannot_clear_handle_or_close_its_streams(self):
        process = UnconfirmedProcess(); client = BoundedNativeClient(('/bin/false',))
        entered, release = threading.Event(), threading.Event(); errors = []
        def communicate(*_args, **_options):
            entered.set(); release.wait(2); return WorkerOutput(b'{}', b'', 0)
        def invoke():
            try: client(private_admission_sql())
            except ValueError: errors.append('held')
        with patch('workers.bounded_native_client.subprocess.Popen', return_value=process), \
                patch('workers.bounded_native_client.communicate_bounded', side_effect=communicate):
            thread = threading.Thread(target=invoke); thread.start()
            try:
                self.assertTrue(entered.wait(1)); client.cancel(); process.returncode = 0
                self.assertFalse(client.confirm_cleanup()); self.assertTrue(client.active)
                self.assertFalse(process.stdin.closed)
            finally: release.set(); thread.join(2)
            self.assertFalse(thread.is_alive()); self.assertEqual(errors, ['held'])
            self.assertTrue(client.cleanup_confirmed); self.assertFalse(client.active)

    def test_stream_cleanup_fault_withholds_success_until_its_owned_cleanup_is_confirmed(self):
        process = UnconfirmedProcess(); process.returncode = 0; client = BoundedNativeClient(('/bin/false',))
        with patch('workers.bounded_native_client.subprocess.Popen', return_value=process), \
                patch('workers.bounded_native_client.communicate_bounded', return_value=WorkerOutput(b'{}', b'', 0)), \
                patch.object(process.stdout, 'close', side_effect=OSError('private-stream-canary')):
            with self.assertRaises(ValueError) as error: client(private_admission_sql())
            self.assertNotIn('canary', str(error.exception)); self.assertTrue(client.active)
            self.assertFalse(client.confirm_cleanup()); self.assertFalse(client.cleanup_confirmed)
        self.assertTrue(client.confirm_cleanup()); self.assertTrue(client.closed)
        self.assertTrue(client.cleanup_confirmed)

    def test_custodian_cannot_return_a_result_with_unconfirmed_owned_native_cleanup(self):
        # Isolate the public finalization seam; the injected body performs no
        # admission, candidate import, worker start, SQL or raw storage.
        process = UnconfirmedProcess(); client = BoundedNativeClient(('/bin/false',))
        with patch('workers.bounded_native_client.subprocess.Popen', return_value=process), \
                patch('workers.bounded_native_client.communicate_bounded', side_effect=BoundedWorkerError('Unconfirmed cleanup')):
            with self.assertRaises(ValueError): client(private_admission_sql())
        backend = object.__new__(PrivatePairNativeBackend); backend.native_client = client; backend.closed = False
        with patch('workers.private_collector_custodian._run_owned_private_collector', return_value='must-not-return'):
            with self.assertRaisesRegex(RuntimeError, '^Private native process cleanup is not confirmed$'):
                run_admitted_private_collector(None, backend, on_admitted=lambda raw: raw)
        self.assertTrue(backend.closed); self.assertTrue(client.active); self.assertEqual(client.calls, 1)

    def test_retained_watchdog_does_not_emit_private_poll_or_signal_errors(self):
        for operation in ('poll', 'kill'):
            with self.subTest(operation=operation):
                process = UnconfirmedProcess(); callbacks = []; leaked = []
                class Timer:
                    def __init__(self, _timeout, callback): callbacks.append(callback)
                    def start(self): pass
                    def cancel(self): pass
                def begin(*_args):
                    with patch.object(process, operation, side_effect=OSError('private-watchdog-canary')):
                        try: callbacks[0]()
                        except Exception as error: leaked.append(str(error))
                    process.returncode = -9
                    raise ValueError('Invented first-phase stop')
                with patch('workers.retained_native_transaction.threading.Timer', Timer), \
                        patch('workers.retained_native_transaction._begin_receipt', side_effect=begin):
                    with self.assertRaises(ValueError): retained_pair_store(process, b'', lambda _raw: None, timeout=.1)
                self.assertEqual(leaked, [], 'The timer must not leak private diagnostics on its separate thread')

    def test_actual_owned_child_later_exit_is_confirmed_after_lost_cleanup_acknowledgement(self):
        # Launch only an invented local sleeper. Preserve the original Popen
        # handle and always reap it using its original methods in this test.
        process = subprocess.Popen((sys.executable, '-B', '-c', 'import time; time.sleep(20)'),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={}, close_fds=True)
        original_poll, original_kill, original_wait = process.poll, process.kill, process.wait
        client = BoundedNativeClient(('/bin/false',))
        try:
            with patch('workers.bounded_native_client.subprocess.Popen', return_value=process), \
                    patch('workers.bounded_native_client.communicate_bounded', side_effect=BoundedWorkerError('Lost cleanup acknowledgement')), \
                    patch.object(process, 'poll', side_effect=OSError('private-poll-canary')), \
                    patch.object(process, 'kill', side_effect=OSError('private-signal-canary')):
                with self.assertRaises(ValueError): client(private_admission_sql())
                self.assertTrue(client.active); self.assertFalse(client.cleanup_confirmed)
                self.assertFalse(client.confirm_cleanup())
            self.assertIsNone(original_poll()); original_kill(); original_wait(timeout=5)
            self.assertTrue(client.confirm_cleanup()); self.assertTrue(client.cleanup_confirmed)
            self.assertFalse(client.active); self.assertTrue(client.closed)
        finally:
            if original_poll() is None: original_kill()
            original_wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr): stream.close()


if __name__ == '__main__': unittest.main()
