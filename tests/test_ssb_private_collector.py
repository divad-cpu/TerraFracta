"""Unconnected private composition; actual children receive invalid input only.

Successful processing below is mocked in-process. No source request, native
admission, credential, raw folder or publication is created by these tests.
"""
from datetime import datetime,timezone
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import socket
import subprocess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from scripts import ssb_private_collector_inventory as inventory
from scripts.admit_private_ssb_collector import AdmittedPrivateCollectorLaunch
from scripts.admit_frozen_ssb_launch import AdmittedFrozenFixtureLaunch
from tests.frozen_ssb_support import admitted_context,frozen_at
from tests import test_ssb_frozen_private_transport as transport_support
from workers.bounded_worker_process import communicate_bounded
from workers.ssb_frozen_private_collector import (CONTRACT_SHA256,private_collector_child_command,
    private_collector_main,_fixed_replace)

ROOT=Path(__file__).resolve().parents[1]


class PrivateCollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'source';self.root.mkdir(mode=0o700)
        self.raw=inventory.inventory(ROOT);self.pin=sha256(self.raw).hexdigest()
        self.manifest=json.loads(self.raw)
        for name in self.manifest['files']:
            path=self.root/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            path.write_bytes((ROOT/name).read_bytes());path.chmod(0o600)
        (self.root/'MANIFEST.json').write_bytes(self.raw);(self.root/'MANIFEST.json').chmod(0o600)
        self.source=inventory.freeze_private_collector_source(self.root,self.pin);self.addCleanup(self.source.close)
        self.now=datetime.now(timezone.utc);self.context,self.expected=admitted_context(self.pin,now=self.now)

    def test_distinct_whole_collector_purpose_has_no_invented_bodies_or_permission(self):
        self.assertEqual(sha256(json.dumps(inventory.CONTRACT,sort_keys=True,separators=(',',':')).encode()).hexdigest(),CONTRACT_SHA256)
        self.assertEqual(self.manifest['roots'],['workers.ssb_frozen_private_collector'])
        self.assertIn('workers/closed_ssb_worker.py',self.manifest['files'])
        self.assertIn('workers/ssb_14059_transport.py',self.manifest['files'])
        self.assertNotIn('workers/ssb_frozen_runtime.py',self.manifest['files'])
        with ZipFile(BytesIO(self.source.check())) as archive:
            self.assertEqual(set(archive.namelist()),set(self.manifest['files'])|{'MANIFEST.json'})
        self.assertIs(inventory.CONTRACT['sourcePermissionIssued'],False)
        self.assertFalse(inventory.verify(self.root,self.pin)['workerExecuted'])

    def test_actual_admitted_worker_changed_stdin_refuses_before_channel_or_http(self):
        launch=AdmittedPrivateCollectorLaunch(self.source,self.context,**self.expected,now=self.now)
        parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
        with parent,child:
            process=launch.start(child);child.close()
            result=communicate_bounded(process,self.context+b' ',timeout=5,max_stderr=1024)
            self.assertEqual((result.returncode,result.stdout,result.stderr),
                (1,b'',b'Frozen private collector candidate refused the operation.\n'))
            parent.settimeout(1);self.assertEqual(parent.recv(4096),b'')
            with self.assertRaises(ValueError):launch.start(parent)

    def test_actual_transport_eof_and_wrong_packet_cannot_start_http(self):
        for packet in (b'',b'{}',b'{"kind":"data","deadline":0,"parentPid":1}'):
            command=private_collector_child_command('metadata',self.source,context_sha256='a'*64,parent_pid=os.getpid())
            process=subprocess.Popen(command,cwd='/',env={},close_fds=True,pass_fds=(self.source.descriptor,),
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            result=communicate_bounded(process,packet,timeout=3,max_stdout=1024,max_stderr=1024)
            self.assertIn(result.returncode,(1,2));self.assertEqual(result.stdout,b'')

    def test_wrong_run_identity_and_private_transport_or_fixture_purpose_refuse_before_spawn(self):
        with self.assertRaises(ValueError):
            AdmittedPrivateCollectorLaunch(self.source,self.context,**{**self.expected,'principal':'changed_principal'},now=self.now)
        fixture=frozen_at(Path(self.temp.name)/'fixture');self.addCleanup(fixture.close)
        helper=transport_support.PrivateTransportSourceTests();helper.setUp();self.addCleanup(helper.doCleanups)
        for other in (fixture,helper.source()):
            raw,expected=admitted_context(other.source_fingerprint,now=self.now)
            with self.assertRaises(ValueError):AdmittedPrivateCollectorLaunch(other,raw,**expected,now=self.now)
        with self.assertRaises(ValueError):AdmittedFrozenFixtureLaunch(self.source,self.context,**self.expected,now=self.now)

    def test_failed_spawn_and_stream_socket_consume_the_private_launch(self):
        for fail_spawn in (True,False):
            launch=AdmittedPrivateCollectorLaunch(self.source,self.context,**self.expected,now=self.now)
            parent,child=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET if fail_spawn else socket.SOCK_STREAM)
            with parent,child,patch('scripts.admit_private_ssb_collector.runtime_record',return_value=self.manifest['interpreter']), \
                    patch('scripts.admit_frozen_ssb_launch.subprocess.Popen',side_effect=OSError('invented failure')) as spawn:
                with self.assertRaises((OSError,ValueError)):launch.start(child)
                with self.assertRaises(ValueError):launch.start(child)
                self.assertEqual(spawn.call_count,int(fail_spawn))

    def test_template_drift_refuses_instead_of_selecting_another_import(self):
        for text in ('no template pattern','marker marker'):
            with self.assertRaises(ValueError):_fixed_replace(text,'marker','replacement')

    def test_native_wiring_harness_refuses_the_actual_http_candidate_before_spawn(self):
        from scripts.private_collector_wiring_source import check_private_wiring_source
        with self.assertRaisesRegex(ValueError,'network-free invented transport'):
            check_private_wiring_source(self.source)

    def test_in_process_private_worker_composition_uses_shared_processing_and_fixed_broker(self):
        # Demonstrate wiring with mocks, never claim an actual capture outcome.
        pending=SimpleNamespace(context=SimpleNamespace(manifest=object(),metadata_retrieved_at=self.now,data_retrieved_at=self.now))
        result=SimpleNamespace(pending=pending,checkpoint=b'pending',closeout=b'partial');output=BytesIO();events=[]
        connection=SimpleNamespace(family=socket.AF_UNIX,type=socket.SOCK_SEQPACKET)
        from contextlib import nullcontext
        client=SimpleNamespace(next_id=17);broker=SimpleNamespace(response_kinds=['metadata','data'])
        with patch('workers.ssb_frozen_private_collector.arm_parent_lifetime',side_effect=lambda p:events.append('guard')), \
                patch('workers.ssb_frozen_private_collector.sys.stdin',SimpleNamespace(buffer=BytesIO(self.context))), \
                patch('workers.ssb_frozen_private_collector.sys.stdout',SimpleNamespace(write=lambda x:output.write(x.encode()),flush=lambda:None)), \
                patch('workers.ssb_frozen_private_collector.socket.socket',return_value=nullcontext(connection)), \
                patch('workers.ssb_frozen_private_collector.PairChannelClient',return_value=client), \
                patch('workers.ssb_frozen_private_collector.PrivateCollectorTransportBroker',return_value=broker) as factory, \
                patch('workers.ssb_frozen_private_collector.process_closed_ssb_context',side_effect=lambda *x:events.append('process') or result), \
                patch('workers.ssb_frozen_private_collector.canonical_run_manifest',return_value='fixed-manifest'):
            self.assertEqual(private_collector_main('worker',self.source.descriptor,self.source.archive_sha256,
                self.pin,9,sha256(self.context).hexdigest(),os.getpid()),0)
        factory.assert_called_once_with(unittest.mock.ANY,sha256(self.context).hexdigest())
        record=json.loads(output.getvalue());self.assertEqual(events,['guard','process'])
        self.assertEqual(record['completedResponseChildren'],2);self.assertEqual(record['operations'],16)
        self.assertFalse(record['sourcePermissionIssued']);self.assertFalse(record['publicationEnabled'])
        self.assertNotIn('actualSourceRequests',record)


if __name__=='__main__':unittest.main()
