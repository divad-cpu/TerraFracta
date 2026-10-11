"""Distinct fixed candidate purpose; actual children only receive invalid startup.

Valid packet tests replace HTTP and lifetime arming in-process. No test here
authorizes a real source request, prepares a writer or changes the primary.
"""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from zipfile import ZipFile, ZIP_STORED

from scripts import ssb_private_transport_inventory as inventory
from tests.frozen_ssb_support import frozen_at, invented_bodies
from workers.bounded_worker_process import communicate_bounded
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL
from workers.ssb_14059_pair_transport import _decode_capture
from workers.ssb_frozen_source import FrozenSSBSource, child_command, seal_source
from workers.ssb_frozen_private_transport import (CONTRACT_SHA256, private_child_command,
    check_private_transport_source, private_transport_main, FrozenPrivateTransportBroker)

ROOT=Path(__file__).resolve().parents[1]


class PrivateTransportSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'private-source';self.root.mkdir(mode=0o700)
        self.raw=inventory.inventory(ROOT);self.pin=sha256(self.raw).hexdigest()
        self.manifest=json.loads(self.raw)
        for name in self.manifest['files']:
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            path.write_bytes((ROOT/name).read_bytes());path.chmod(0o600)
        path=self.root/'MANIFEST.json';path.write_bytes(self.raw);path.chmod(0o600)

    def source(self):
        source=inventory.freeze_private_transport_source(self.root,self.pin)
        self.addCleanup(source.close);return source

    def actual_child(self,source,packet):
        command=private_child_command('metadata',source,parent_pid=os.getpid())
        process=subprocess.Popen(command,cwd='/',env={},close_fds=True,
            pass_fds=(source.descriptor,),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        return communicate_bounded(process,packet,timeout=3,max_stdout=100000,max_stderr=1024)

    def test_fixed_distinct_purpose_and_archive_have_no_fictional_bodies_or_credentials(self):
        checked=inventory.verify(self.root,self.pin);self.assertFalse(checked['workerExecuted'])
        self.assertEqual(self.manifest['roots'],['workers.ssb_frozen_private_transport'])
        self.assertEqual(sha256(json.dumps(inventory.CONTRACT,sort_keys=True,separators=(',',':')).encode()).hexdigest(),CONTRACT_SHA256)
        self.assertIs(inventory.CONTRACT['sourcePermissionIssued'],False)
        self.assertNotIn('workers/closed_ssb_worker.py',self.manifest['files'])
        source=self.source()
        with ZipFile(BytesIO(source.check())) as archive:
            self.assertEqual(set(archive.namelist()),set(self.manifest['files'])|{'MANIFEST.json'})
            self.assertFalse(any(x.startswith('fixtures/') for x in archive.namelist()))

    def test_wrong_pin_changed_contract_source_or_interpreter_cannot_freeze(self):
        for pin in ('0'*64,True):
            with self.subTest(pin=pin),self.assertRaises(ValueError):
                inventory.freeze_private_transport_source(self.root,pin)
        changed={**self.manifest,'contract':{**inventory.CONTRACT,'sourcePermissionIssued':True}}
        encoded=json.dumps(changed).encode();(self.root/'MANIFEST.json').write_bytes(encoded)
        with self.assertRaises(ValueError):inventory.freeze_private_transport_source(self.root,sha256(encoded).hexdigest())
        (self.root/'MANIFEST.json').write_bytes(self.raw)
        path=self.root/'workers/ssb_frozen_private_transport.py';path.write_bytes(path.read_bytes()+b'\n#changed\n')
        with self.assertRaises(ValueError):self.source()

    def test_actual_child_eof_bad_packet_changed_kind_parent_or_deadline_does_not_fetch(self):
        source=self.source()
        base={'kind':'metadata','deadline':time.monotonic()+5,'parentPid':os.getpid()}
        packets=(b'',b'{}',json.dumps({**base,'kind':'data'}).encode(),
            json.dumps({**base,'parentPid':1}).encode(),json.dumps({**base,'deadline':0}).encode(),
            json.dumps({**base,'endpoint':'https://private-canary.invalid/'}).encode())
        for packet in packets:
            with self.subTest(packet=packet):
                result=self.actual_child(source,packet)
                self.assertIn(result.returncode,(1,2));self.assertEqual(result.stdout,b'')
                self.assertNotIn(b'canary',result.stderr)

    def test_invented_archive_is_refused_by_private_parent_before_any_spawn(self):
        source=frozen_at(Path(self.temp.name)/'fictional-source');self.addCleanup(source.close)
        with patch('subprocess.Popen') as process:
            with self.assertRaises(ValueError):private_child_command('metadata',source,parent_pid=os.getpid())
            with self.assertRaises(ValueError):FrozenPrivateTransportBroker(source)
            process.assert_not_called()

    def test_private_archive_cannot_use_invented_child_entry(self):
        source=self.source();command=child_command('metadata',source,context_sha256='a'*64,parent_pid=os.getpid())
        process=subprocess.Popen(command,cwd='/',env={},close_fds=True,pass_fds=(source.descriptor,),
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        result=communicate_bounded(process,b'',timeout=3,max_stdout=1000,max_stderr=1024)
        self.assertEqual(result.returncode,1);self.assertEqual(result.stdout,b'')
        self.assertEqual(result.stderr,b'Frozen private SSB worker refused the operation.\n')

    def test_actual_modified_resealed_member_refuses_before_candidate_initialization(self):
        source=self.source();target=BytesIO()
        with ZipFile(BytesIO(source.check())) as archive,ZipFile(target,'w',compression=ZIP_STORED) as out:
            for name in archive.namelist():
                out.writestr(name,b'raise RuntimeError("initialization-canary")\n' if name=='workers/__init__.py' else archive.read(name))
        fd,digest=seal_source(target.getvalue());bad=FrozenSSBSource(fd,digest,self.pin,source.source_files);self.addCleanup(bad.close)
        result=self.actual_child(bad,b'')
        self.assertEqual((result.returncode,result.stdout,result.stderr),
            (1,b'',b'Frozen private transport candidate refused the operation.\n'))

    def test_valid_unit_packet_uses_fixed_http_function_with_guard_before_fetch(self):
        source=self.source();capture=CapturedResponse(METADATA_URL,METADATA_URL,0,200,'application/json',
            invented_bodies()['metadata'],datetime.now(timezone.utc));events=[]
        output=BytesIO();packet=json.dumps({'kind':'metadata','deadline':time.monotonic()+5,'parentPid':os.getpid()}).encode()
        def fetch(kind,*,deadline):events.append('fetch');return capture
        def guard(parent):events.append('guard')
        with patch('workers.ssb_frozen_private_transport.arm_parent_lifetime',side_effect=guard), \
                patch('workers.ssb_14059_pair_transport.arm_parent_lifetime',side_effect=guard), \
                patch('workers.ssb_frozen_private_transport.fetch_ssb_14059_once',side_effect=fetch) as http, \
                patch('workers.ssb_14059_pair_transport.sys.stdin',SimpleNamespace(buffer=BytesIO(packet))), \
                patch('workers.ssb_14059_pair_transport.sys.stdout',SimpleNamespace(buffer=output)):
            self.assertEqual(private_transport_main('metadata',source.descriptor,source.archive_sha256,self.pin,os.getpid()),0)
        self.assertEqual(events,['guard','guard','fetch']);http.assert_called_once()
        self.assertEqual(_decode_capture('metadata',output.getvalue()).body,capture.body)

    def test_argument_and_capability_selectors_are_not_exposed(self):
        source=self.source()
        for kind,parent in (('worker',os.getpid()),('--url',os.getpid()),('metadata',True),('metadata',1)):
            with self.subTest(kind=kind,parent=parent),self.assertRaises(ValueError):
                private_child_command(kind,source,parent_pid=parent)

    def test_actual_executable_hash_is_checked_before_private_transport_import(self):
        source=self.source();copy=Path(self.temp.name)/'different-python'
        copy.write_bytes(Path('/usr/bin/python3.12').read_bytes()+b'\nprivate-test-extra-bytes\n');copy.chmod(0o700)
        command=private_child_command('metadata',source,parent_pid=os.getpid());command[0]=str(copy)
        process=subprocess.Popen(command,cwd='/',env={},close_fds=True,pass_fds=(source.descriptor,),
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        result=communicate_bounded(process,b'',timeout=3,max_stdout=1000,max_stderr=1024)
        self.assertEqual((result.returncode,result.stdout,result.stderr),
            (1,b'',b'Frozen private transport candidate refused the operation.\n'))


if __name__=='__main__':unittest.main()
