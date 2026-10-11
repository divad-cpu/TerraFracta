"""Startup cleanup with mocked native admission; original HTTP never launches."""
import json
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
import threading
import unittest
from unittest.mock import patch

from tests import test_ssb_private_collector as source_support
from tests.frozen_ssb_support import admitted_context
from tests.test_native_pair_admission import admission_fixture
from workers.bounded_native_client import BoundedNativeClient,NativeClientReply
from workers.private_pair_native_backend import PrivatePairNativeBackend
from workers.private_collector_custodian import run_admitted_private_collector
from workers.ssb_14059_raw_custody import PrivateRawCustody


class PrivateCustodianStartupTests(unittest.TestCase):
    def setUp(self):
        helper=source_support.PrivateCollectorTests();helper.setUp();self.addCleanup(helper.doCleanups)
        self.source,self.raw_context,self.now=helper.source,helper.context,helper.now
        self.pin=helper.pin
        temporary=TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.custody=self.enterContext(PrivateRawCustody(Path(temporary.name)/'raw',utc_now=lambda:self.now))
        self.client=BoundedNativeClient(('/bin/false',));self.addCleanup(self.client.cancel)
        self.backend=PrivatePairNativeBackend(self.client,self.custody,self.raw_context,self.pin,utc_now=lambda:self.now)
        self.reply=NativeClientReply(0,json.dumps(admission_fixture(self.raw_context,self.pin,self.now)))

    def collect(self):
        return run_admitted_private_collector(self.source,self.backend,on_admitted=lambda raw:raw,utc_now=lambda:self.now)

    def assert_closed_without_capture(self):
        self.assertTrue(self.client.closed);self.assertFalse(self.client.active)
        self.assertTrue(self.backend.closed);self.assertFalse(self.backend.store_consumed)
        self.assertEqual(self.custody.inventory(now=self.now),())
        self.assertFalse(any(thread.name=='private-native-custodian' and thread.is_alive()
            for thread in threading.enumerate()))

    def test_source_pin_mismatch_closes_owned_client_before_native_query_or_worker_spawn(self):
        raw,_=admitted_context('b'*64,now=self.now)
        self.backend=PrivatePairNativeBackend(self.client,self.custody,raw,'b'*64,utc_now=lambda:self.now)
        with patch.object(BoundedNativeClient,'__call__',return_value=self.reply) as native, \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start') as launch:
            with self.assertRaises(ValueError):self.collect()
            native.assert_not_called();launch.assert_not_called()
        self.assert_closed_without_capture()

    def test_unavailable_native_admission_closes_client_without_worker_start(self):
        with patch.object(BoundedNativeClient,'__call__',side_effect=TimeoutError('private-canary')) as native, \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start') as launch:
            with self.assertRaises(ValueError) as error:self.collect()
            self.assertNotIn('canary',str(error.exception));self.assertEqual(native.call_count,1)
            launch.assert_not_called()
        self.assert_closed_without_capture()

    def test_socket_creation_failure_after_admission_closes_native_client(self):
        with patch.object(BoundedNativeClient,'__call__',return_value=self.reply) as native, \
                patch('workers.private_collector_custodian.socket.socketpair',side_effect=OSError('invented socket failure')), \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start') as launch:
            with self.assertRaises(OSError):self.collect()
            self.assertEqual(native.call_count,1);launch.assert_not_called()
        self.assert_closed_without_capture()

    def test_failed_private_admission_journal_stops_before_worker_start_and_closes_client(self):
        recorded=[]
        def fail(raw):
            recorded.append(raw);raise OSError('invented private journal failure')
        with patch.object(BoundedNativeClient,'__call__',return_value=self.reply) as native, \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start') as launch:
            with self.assertRaises(OSError):
                run_admitted_private_collector(self.source,self.backend,on_admitted=fail,utc_now=lambda:self.now)
            self.assertEqual(native.call_count,1);launch.assert_not_called()
        self.assertEqual(len(recorded),1)
        self.assertEqual(recorded[0],self.backend.admission_receipt)
        self.assert_closed_without_capture()

    def test_changed_private_journal_readback_stops_before_worker_start(self):
        with patch.object(BoundedNativeClient,'__call__',return_value=self.reply), \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start') as launch:
            with self.assertRaises(ValueError):
                run_admitted_private_collector(self.source,self.backend,on_admitted=lambda raw:raw+b' ',utc_now=lambda:self.now)
            launch.assert_not_called()
        self.assert_closed_without_capture()

    def test_thread_creation_failure_closes_both_created_sockets_and_native_client(self):
        original=socket.socketpair;created=[]
        def pair(*args):
            result=original(*args);created.extend(result);return result
        with patch.object(BoundedNativeClient,'__call__',return_value=self.reply), \
                patch('workers.private_collector_custodian.socket.socketpair',side_effect=pair), \
                patch('workers.private_collector_custodian.threading.Thread.start',side_effect=RuntimeError('invented thread failure')), \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start') as launch:
            with self.assertRaises(RuntimeError):self.collect()
            launch.assert_not_called()
        self.assertEqual(len(created),2);self.assertTrue(all(x.fileno()==-1 for x in created))
        self.assert_closed_without_capture()

    def test_failed_worker_spawn_ends_the_already_started_channel_thread(self):
        with patch.object(BoundedNativeClient,'__call__',return_value=self.reply), \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start',side_effect=OSError('invented spawn failure')) as launch:
            with self.assertRaises(OSError):self.collect()
            self.assertEqual(launch.call_count,1)
        self.assert_closed_without_capture()

    def test_failed_spawn_still_ends_channel_when_shutdown_is_unavailable(self):
        with patch.object(BoundedNativeClient,'__call__',return_value=self.reply), \
                patch('workers.private_collector_custodian.AdmittedPrivateCollectorLaunch.start',side_effect=OSError('invented spawn failure')), \
                patch.object(socket.socket,'shutdown',side_effect=PermissionError('invented shutdown refusal')):
            with self.assertRaisesRegex(OSError,'^invented spawn failure$'):self.collect()
        self.assert_closed_without_capture()


if __name__=='__main__':unittest.main()
