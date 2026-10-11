"""Exclusive persistence and fsync failures with invented admission only."""
from datetime import datetime,timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import os
import unittest
from unittest.mock import patch

from tests.frozen_ssb_support import admitted_context
from tests.test_native_pair_admission import admission_fixture
from workers.private_admission_journal import FILENAME,record_private_admission


class PrivateAdmissionJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.root.chmod(0o700)
        now=datetime(2026,10,2,11,tzinfo=timezone.utc);context,_=admitted_context('a'*64,now=now)
        self.raw=json.dumps(admission_fixture(context,'a'*64,now)).encode()

    def test_file_and_directory_are_fsynced_then_exact_private_bytes_reopened(self):
        original=os.fsync;observed=[]
        def sync(fd):observed.append(os.fstat(fd).st_mode);original(fd)
        with patch('workers.private_admission_journal.os.fsync',side_effect=sync):
            self.assertEqual(record_private_admission(self.root,self.raw),self.raw)
        import stat
        self.assertEqual(len(observed),2);self.assertTrue(stat.S_ISREG(observed[0]));self.assertTrue(stat.S_ISDIR(observed[1]))
        self.assertEqual((self.root/FILENAME).stat().st_mode&0o777,0o600)

    def test_existing_record_is_preserved_without_overwrite_or_replay(self):
        record_private_admission(self.root,self.raw);path=self.root/FILENAME;inode=path.stat().st_ino
        with self.assertRaises(ValueError):record_private_admission(self.root,self.raw)
        self.assertEqual(path.read_bytes(),self.raw);self.assertEqual(path.stat().st_ino,inode)

    def test_fsync_failure_keeps_partial_evidence_and_cannot_return_acceptance(self):
        with patch('workers.private_admission_journal.os.fsync',side_effect=OSError('private-canary')):
            with self.assertRaises(ValueError) as error:record_private_admission(self.root,self.raw)
        self.assertNotIn('canary',str(error.exception));self.assertEqual((self.root/FILENAME).read_bytes(),self.raw)
        with self.assertRaises(ValueError):record_private_admission(self.root,self.raw)

    def test_changed_readback_is_refused_without_rewriting_the_record(self):
        with patch('workers.private_admission_journal.private_read',return_value=self.raw+b' '):
            with self.assertRaises(ValueError):record_private_admission(self.root,self.raw)
        self.assertEqual((self.root/FILENAME).read_bytes(),self.raw)

    def test_invalid_record_or_broad_directory_stops_before_creating_a_file(self):
        for raw in (b'{}',b'\xff',self.raw[:-1]+b',"schemaVersion":1}'):
            with self.assertRaises(ValueError):record_private_admission(self.root,raw)
            self.assertFalse((self.root/FILENAME).exists())
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):record_private_admission(self.root,self.raw)
        self.assertFalse((self.root/FILENAME).exists())


if __name__=='__main__':unittest.main()
