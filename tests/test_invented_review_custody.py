"""Owned Unix handshakes, exclusive fsync and inherited real flock behavior."""
from contextlib import ExitStack
from datetime import datetime
from hashlib import sha256
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.fictional_trial_guard import trial_process_lock
from workers import invented_review_custody as custody


class InventedReviewCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.directory=self.base/'proof';self.directory.mkdir(mode=0o700)
        self.pins={'intake':'a'*64,'reliability':'b'*64,'review':'c'*64}
        self.packet={'schemaVersion':1,'evidenceKind':'invented_review_owned_start',
            'suffix':'20261003090000_abcdef','candidateSha256':self.pins}

    def test_identity_derives_only_five_fixed_owned_roles_and_database(self):
        database,roles=custody.owned_names(self.packet['suffix'])
        self.assertEqual(database,'terra_successor_'+self.packet['suffix']);self.assertEqual(len(roles),5)
        for suffix in ('postgres','20261303090000_abcdef','20261003090000_abcdef;select 1',True,'20261003090000_ABCDEf'):
            with self.subTest(suffix=suffix),self.assertRaises((ValueError,TypeError)):custody.owned_names(suffix)
        for changed in ({'schemaVersion':True},{'target':'primary'},{'roles':['postgres']},{'candidateSha256':{}}):
            with self.subTest(change=changed),self.assertRaises(ValueError):custody.checked_start({**self.packet,**changed},self.pins)

    def test_current_review_pin_drift_refuses_before_any_native_trial(self):
        from scripts import check_invented_correction_review as review
        selected=object.__new__(custody.ReviewWorkerCustody);selected.pins=self.pins
        with patch.object(review.sys,'argv',['fixed-review']),patch.object(review,'trial') as native:
            with self.assertRaisesRegex(ValueError,'binding differs before start'):review.main(custody=selected)
            native.assert_not_called()

    def test_exact_ownership_is_fsynced_and_reopened_before_ack_and_never_overwritten(self):
        calls=[];original=os.fsync
        def sync(fd):calls.append(fd);original(fd)
        with patch('workers.invented_operation_journal.os.fsync',side_effect=sync):
            raw=custody.record_owned_start(self.directory,self.packet,self.pins)
        self.assertEqual(len(calls),2);self.assertEqual((self.directory/custody.OWNERSHIP).read_bytes(),raw)
        self.assertEqual((self.directory/custody.OWNERSHIP).stat().st_mode&0o777,0o600)
        with self.assertRaises(FileExistsError):custody.record_owned_start(self.directory,self.packet,self.pins)
        self.assertEqual((self.directory/custody.OWNERSHIP).read_bytes(),raw)

    def test_failed_ownership_sync_retains_original_and_cannot_receive_a_successful_ack(self):
        with patch('workers.invented_operation_journal.os.fsync',side_effect=OSError('private-canary')):
            with self.assertRaises(OSError):custody.record_owned_start(self.directory,self.packet,self.pins)
        before=(self.directory/custody.OWNERSHIP).read_bytes()
        with self.assertRaises(FileExistsError):custody.record_owned_start(self.directory,self.packet,self.pins)
        self.assertEqual((self.directory/custody.OWNERSHIP).read_bytes(),before)

    def test_real_socket_frames_refuse_oversize_duplicate_and_truncated_packets(self):
        for raw in (b'{"a":1,"a":2}',b'[]',b'\xff'):
            with self.subTest(raw=raw):
                left,right=socket.socketpair()
                try:
                    left.sendall(len(raw).to_bytes(4,'big')+raw);left.shutdown(socket.SHUT_WR)
                    with self.assertRaises(ValueError):custody.receive_packet(right)
                finally:left.close();right.close()
        left,right=socket.socketpair()
        try:
            custody.send_packet(left,self.packet);self.assertEqual(custody.receive_packet(right),self.packet)
            left.sendall((4097).to_bytes(4,'big'))
            with self.assertRaises(ValueError):custody.receive_packet(right)
        finally:left.close();right.close()

    def test_ack_types_and_whole_frame_deadline_cannot_be_extended_by_partial_delivery(self):
        expected={'schemaVersion':1,'status':'continue_invented_review'}
        for wrong in (True,1.0,'1'):
            with self.subTest(schema=wrong),self.assertRaises(ValueError):custody.exact_packet({**expected,'schemaVersion':wrong},expected)
        class SlowFrame:
            def __init__(self):self.calls=0;self.timeouts=[]
            def gettimeout(self):return 25
            def settimeout(self,value):self.timeouts.append(value)
            def recv(self,size):self.calls+=1;return b'\0'
        stream=SlowFrame()
        with patch('workers.invented_review_custody.time.monotonic',side_effect=[100,101,101,109,109,111]):
            with self.assertRaises(ValueError):custody.receive_packet(stream,timeout=10)
        self.assertEqual(stream.calls,2);self.assertEqual(stream.timeouts,[9,1,25])

    def test_actual_inherited_open_description_remains_exclusive_after_child_guard_exits(self):
        directory=self.base/'guard'
        code='from pathlib import Path;from workers.invented_review_custody import borrowed_trial_guard;import os,sys\nwith borrowed_trial_guard(int(sys.argv[1]),int(sys.argv[2]),directory=Path(sys.argv[3])):print("borrowed")'
        check='from pathlib import Path;from scripts.fictional_trial_guard import trial_process_lock;import sys\nwith trial_process_lock(Path(sys.argv[1])):print("acquired")'
        with trial_process_lock(directory) as fd:
            child=subprocess.run([sys.executable,'-B','-c',code,str(fd),str(os.getpid()),str(directory)],pass_fds=(fd,),capture_output=True,text=True,timeout=5)
            self.assertEqual(child.returncode,0,child.stderr);self.assertEqual(child.stdout.strip(),'borrowed')
            refused=subprocess.run([sys.executable,'-B','-c',check,str(directory)],capture_output=True,text=True,timeout=5)
            self.assertNotEqual(refused.returncode,0);self.assertNotIn('acquired',refused.stdout)
        allowed=subprocess.run([sys.executable,'-B','-c',check,str(directory)],capture_output=True,text=True,timeout=5)
        self.assertEqual(allowed.returncode,0,allowed.stderr)

    def test_other_open_description_wrong_parent_and_unlocked_fd_refuse(self):
        directory=self.base/'guard'
        with trial_process_lock(directory) as inherited:
            other=os.open(directory/'process.lock',os.O_RDWR)
            try:
                with self.assertRaises(ValueError),custody.borrowed_trial_guard(inherited,True,directory=directory):pass
                with self.assertRaises(BlockingIOError),custody.borrowed_trial_guard(other,os.getppid(),directory=directory):pass
            finally:os.close(other)
        unlocked=os.open(directory/'process.lock',os.O_RDWR)
        try:
            with self.assertRaises(ValueError),custody.borrowed_trial_guard(unlocked,os.getppid(),directory=directory):pass
        finally:os.close(unlocked)


if __name__=='__main__':unittest.main()
