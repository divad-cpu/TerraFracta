"""Private advisory coordination, expiry withholding and crash release."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from workers.ssb_14059_raw_custody import PrivateRawCustody, PrivateRawCustodyError
from workers.ssb_14059_raw_store import RETENTION

FIXTURES=Path(__file__).resolve().parents[1]/'fixtures'


class PrivateRawCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temporary=TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)/'raw'
        self.now=datetime(2026,10,1,12,tzinfo=timezone.utc)
        self.responses=tuple(CapturedResponse(url,url,0,200,'application/json',(FIXTURES/name).read_bytes(),self.now)
            for url,name in ((METADATA_URL,'ssb_14059_metadata_minimal_2024_2025.json'),(DATA_URL,'ssb_14059_jsonstat_minimal_2024_2025.json')))

    def test_coordinated_store_read_inventory_and_exact_expiry(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            saved=custody.store(*self.responses,now=self.now)
            read=custody.read(saved.attempt_id,now=self.now)
            self.assertEqual((read.metadata_response,read.data_response),self.responses)
            self.assertEqual(read.expires_at,self.now+RETENTION)
            self.assertEqual(len(custody.inventory(now=self.now)),1)
            with patch('pathlib.Path.read_bytes',side_effect=AssertionError('expired raw bytes opened')):
                with self.assertRaises(PrivateRawCustodyError): custody.read(saved.attempt_id,now=read.expires_at)
            self.assertEqual(custody.prune(now=read.expires_at,dry_run=True),1)
            self.assertEqual(custody.prune(now=read.expires_at),1)
            self.assertEqual(custody.inventory(now=read.expires_at),())
        self.assertTrue(custody._lock_path.exists());self.assertEqual(custody._lock_path.stat().st_size,0)

    def test_expiry_crossing_during_integrity_read_withholds_the_result(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            saved=custody.store(*self.responses,now=self.now)
            observation=self.now+RETENTION-timedelta(seconds=1)
            with patch('workers.ssb_14059_raw_custody.monotonic',side_effect=[100,100,100,100,102]), self.assertRaises(PrivateRawCustodyError):
                custody.read(saved.attempt_id,now=observation)
            self.assertTrue(saved.directory.exists())

    def test_expiry_during_inventory_manifest_read_never_opens_either_body(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            saved=custody.store(*self.responses,now=self.now)
            observation=self.now+RETENTION-timedelta(seconds=1)
            tick=[100.0];manifest_reads=[];body_opens=[]
            original_text=Path.read_text;original_body=Path.read_bytes
            def manifest(path,*args,**kwargs):
                value=original_text(path,*args,**kwargs)
                if path.name=='manifest.json':
                    manifest_reads.append(path)
                    if len(manifest_reads)==2:tick[0]=102.0
                return value
            def body(path,*args,**kwargs):
                if path.name in ('metadata.json','data.json'):body_opens.append(path.name)
                return original_body(path,*args,**kwargs)
            with patch('workers.ssb_14059_raw_custody.monotonic',side_effect=lambda:tick[0]), \
                    patch('pathlib.Path.read_text',manifest),patch('pathlib.Path.read_bytes',body):
                with self.assertRaises(PrivateRawCustodyError):custody.read(saved.attempt_id,now=observation)
            self.assertEqual(body_opens,[]);self.assertEqual(len(manifest_reads),2)
            self.assertTrue(saved.directory.exists())

    def test_expiry_after_metadata_read_prevents_data_body_open(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            saved=custody.store(*self.responses,now=self.now)
            observation=self.now+RETENTION-timedelta(seconds=1);tick=[100.0];opened=[]
            original=Path.read_bytes
            def body(path,*args,**kwargs):
                if path.name in ('metadata.json','data.json'):
                    opened.append(path.name);value=original(path,*args,**kwargs);tick[0]=102.0;return value
                return original(path,*args,**kwargs)
            with patch('workers.ssb_14059_raw_custody.monotonic',side_effect=lambda:tick[0]),patch('pathlib.Path.read_bytes',body):
                with self.assertRaises(PrivateRawCustodyError):custody.read(saved.attempt_id,now=observation)
            self.assertEqual(opened,['metadata.json'])

    def test_current_utc_crossing_during_manifest_preflight_refuses_even_with_explicit_observation(self):
        current=[self.now];opened=[];original_text=Path.read_text;original_body=Path.read_bytes
        with PrivateRawCustody(self.root,utc_now=lambda:current[0]) as custody:
            saved=custody.store(*self.responses,now=self.now)
            def manifest(path,*args,**kwargs):
                value=original_text(path,*args,**kwargs)
                if path.name=='manifest.json':current[0]=self.now+RETENTION
                return value
            def body(path,*args,**kwargs):
                opened.append(path.name);return original_body(path,*args,**kwargs)
            with patch('workers.ssb_14059_raw_custody.monotonic',return_value=100), \
                    patch('pathlib.Path.read_text',manifest),patch('pathlib.Path.read_bytes',body):
                with self.assertRaises(PrivateRawCustodyError):custody.read(saved.attempt_id,now=self.now)
            self.assertEqual(opened,[]);self.assertTrue(saved.directory.exists())

    def test_current_utc_crossing_after_metadata_refuses_second_open(self):
        current=[self.now];opened=[];original=Path.read_bytes
        with PrivateRawCustody(self.root,utc_now=lambda:current[0]) as custody:
            saved=custody.store(*self.responses,now=self.now)
            def body(path,*args,**kwargs):
                value=original(path,*args,**kwargs);opened.append(path.name);current[0]=self.now+RETENTION;return value
            with patch('workers.ssb_14059_raw_custody.monotonic',return_value=100),patch('pathlib.Path.read_bytes',body):
                with self.assertRaises(PrivateRawCustodyError):custody.read(saved.attempt_id,now=self.now)
            self.assertEqual(opened,['metadata.json'])

    def test_backward_wall_clock_does_not_extend_monotonic_retention_window(self):
        current=[self.now];tick=[100.0];original=Path.read_text
        with PrivateRawCustody(self.root,utc_now=lambda:current[0]) as custody:
            saved=custody.store(*self.responses,now=self.now)
            observation=self.now+RETENTION-timedelta(seconds=1)
            def manifest(path,*args,**kwargs):
                value=original(path,*args,**kwargs);current[0]=self.now-timedelta(days=1);tick[0]=102.0;return value
            with patch('workers.ssb_14059_raw_custody.monotonic',side_effect=lambda:tick[0]), \
                    patch('pathlib.Path.read_text',manifest), \
                    patch('pathlib.Path.read_bytes',side_effect=AssertionError('expired body opened')):
                with self.assertRaises(PrivateRawCustodyError):custody.read(saved.attempt_id,now=observation)

    def test_read_does_not_open_unrelated_expired_pair(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            old=custody.store(*self.responses,now=self.now)
            recent_time=self.now+RETENTION
            recent_responses=tuple(CapturedResponse(x.requested_url,x.final_url,x.redirect_count,x.status,
                x.content_type,x.body,recent_time) for x in self.responses)
            selected=custody.store(*recent_responses,now=recent_time)
            opened=[];original=Path.read_bytes
            def body(path,*args,**kwargs):
                if path.name in ('metadata.json','data.json'):
                    self.assertNotEqual(path.parent,old.directory);opened.append(path.name)
                return original(path,*args,**kwargs)
            with patch('pathlib.Path.read_bytes',body):read=custody.read(selected.attempt_id,now=recent_time)
            self.assertEqual(read.data_response,recent_responses[1]);self.assertEqual(opened,['metadata.json','data.json'])

    def test_namespace_observation_never_opens_raw_or_manifest_bytes(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            self.assertTrue(custody.is_empty());self.assertEqual(custody.attempt_names(),())
            saved=custody.store(*self.responses,now=self.now)
            with patch('pathlib.Path.read_bytes',side_effect=AssertionError('raw bytes opened')), \
                    patch('pathlib.Path.read_text',side_effect=AssertionError('manifest opened')):
                self.assertFalse(custody.is_empty());self.assertEqual(custody.attempt_names(),(saved.attempt_id,))
            self.assertTrue(saved.directory.exists())

    def test_namespace_unknown_file_and_symlink_are_preserved_and_refused(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            unknown=self.root/'retained';unknown.write_bytes(b'invented-preserved')
            with self.assertRaises(PrivateRawCustodyError):custody.attempt_names()
            self.assertFalse(custody.is_empty());self.assertEqual(unknown.read_bytes(),b'invented-preserved')

    def test_actual_child_contention_then_crash_releases_only_os_lock(self):
        code='from pathlib import Path;import sys,time;from workers.ssb_14059_raw_custody import PrivateRawCustody\nwith PrivateRawCustody(Path(sys.argv[1])): print("held",flush=True);time.sleep(10)'
        child=subprocess.Popen([sys.executable,'-c',code,str(self.root)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            self.assertEqual(child.stdout.readline(),'held\n')
            with self.assertRaises(PrivateRawCustodyError):
                with PrivateRawCustody(self.root,utc_now=lambda:self.now): self.fail('Second custodian entered')
        finally:
            child.kill();child.wait(timeout=2);child.stdout.close();child.stderr.close()
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            self.assertEqual(custody.inventory(now=self.now),())
            self.assertEqual(custody._lock_path.stat().st_size,0)

    def test_outside_context_nested_context_or_changed_identity_refused(self):
        custody=PrivateRawCustody(self.root,utc_now=lambda:self.now)
        with self.assertRaises(PrivateRawCustodyError): custody.inventory(now=self.now)
        with custody:
            with self.assertRaises(PrivateRawCustodyError): custody.__enter__()
            custody._lock_path.unlink();custody._lock_path.touch(mode=0o600)
            with self.assertRaises(PrivateRawCustodyError): custody.inventory(now=self.now)
        with self.assertRaises(PrivateRawCustodyError): custody.prune(now=self.now)

    def test_symlink_shared_mode_hardlink_or_nonempty_lock_refused_without_altering_them(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody: lock=custody._lock_path
        for case in ('shared','nonempty','hardlink','symlink'):
            with self.subTest(case=case):
                lock.unlink(missing_ok=True)
                if case=='symlink': lock.symlink_to(self.root/'other')
                else:
                    lock.touch(mode=0o600)
                    if case=='shared': lock.chmod(0o644)
                    if case=='nonempty': lock.write_bytes(b'preserved')
                    if case=='hardlink': os.link(lock,self.root.parent/'other-link')
                with self.assertRaises(PrivateRawCustodyError):
                    with PrivateRawCustody(self.root,utc_now=lambda:self.now): pass
                if case=='nonempty': self.assertEqual(lock.read_bytes(),b'preserved')
                if case=='symlink': self.assertTrue(lock.is_symlink())

    def test_forged_lifetime_modified_body_and_unrelated_file_are_held(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            saved=custody.store(*self.responses,now=self.now)
            manifest=saved.directory/'manifest.json'; original=manifest.read_bytes()
            changed=json.loads(original);changed['expires_at']=(self.now+RETENTION+timedelta(seconds=1)).isoformat()
            manifest.write_text(json.dumps(changed))
            with self.assertRaises(PrivateRawCustodyError): custody.read(saved.attempt_id,now=self.now)
            manifest.write_bytes(original)
            data=saved.directory/'data.json';original_data=data.read_bytes();data.write_bytes(b'x'*len(original_data))
            with self.assertRaises(PrivateRawCustodyError): custody.read(saved.attempt_id,now=self.now)
            data.write_bytes(original_data)
            unknown=self.root/'unknown';unknown.write_bytes(b'preserved')
            with self.assertRaises(PrivateRawCustodyError): custody.prune(now=self.now+RETENTION)
            self.assertEqual(unknown.read_bytes(),b'preserved');self.assertTrue(data.exists())

    def test_path_traversal_pending_or_future_clock_not_readable(self):
        with PrivateRawCustody(self.root,utc_now=lambda:self.now) as custody:
            saved=custody.store(*self.responses,now=self.now)
            for identity in ('../secret','.pending-'+saved.attempt_id,saved.attempt_id.upper(),True):
                with self.subTest(identity=identity),self.assertRaises(PrivateRawCustodyError): custody.read(identity,now=self.now)
            # A reader observation before retrieval must not expose a future
            # pair merely because its retention window has not yet ended.
            with self.assertRaises(PrivateRawCustodyError): custody.read(saved.attempt_id,now=self.now-timedelta(seconds=1))

if __name__=='__main__': unittest.main()
