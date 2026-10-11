"""Only generated temporary fixture custody is exercised; no actual private SSB attempt."""
from datetime import datetime, timedelta, timezone
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch
import json
import unittest

from workers.ssb_14059_capture import CapturedResponse,METADATA_URL,DATA_URL
from workers.ssb_14059_raw_store import inspect_private_ssb_14059_pairs,prune_expired_ssb_14059_pairs,SSB14059RawStoreError,RETENTION
from workers.ssb_14059_raw_custody import PrivateRawCustody,PrivateRawCustodyError

FIXTURES=Path(__file__).resolve().parents[1]/'fixtures'
FIELDS=(('metadata','retrieved_at'),('data','retrieved_at'),('stored_at',),('expires_at',),('source_updated_at',))


def change(value,path,new):
    if len(path)==2:value[path[0]][path[1]]=new
    else:value[path[0]]=new


def field(value,path):
    return value[path[0]][path[1]] if len(path)==2 else value[path[0]]


class RawManifestTimePrecisionTests(unittest.TestCase):
    def setUp(self):
        temporary=TemporaryDirectory();self.addCleanup(temporary.cleanup);self.root=Path(temporary.name)/'raw'
        self.now=datetime(2026,10,2,10,tzinfo=timezone.utc)
        self.custody=self.enterContext(PrivateRawCustody(self.root,utc_now=lambda:self.now))
        responses=tuple(CapturedResponse(url,url,0,200,'application/json',(FIXTURES/name).read_bytes(),self.now)
                        for url,name in ((METADATA_URL,'ssb_14059_metadata_minimal_2024_2025.json'),(DATA_URL,'ssb_14059_jsonstat_minimal_2024_2025.json')))
        self.saved=self.custody.store(*responses,now=self.now)
        self.manifest_path=self.saved.directory/'manifest.json';self.original=self.manifest_path.read_bytes()
        self.before={p.name:p.read_bytes() for p in self.saved.directory.iterdir()}

    def mutate(self,path,fraction='0000001'):
        value=json.loads(self.original);stamp=field(value,path)
        # Actual writer uses whole seconds in this fixture; source time uses Z.
        if stamp.endswith('Z'):stamp=stamp[:-1]+'.'+fraction+'Z'
        else:stamp=stamp.replace('+00:00','.'+fraction+'+00:00')
        change(value,path,stamp);self.manifest_path.write_text(json.dumps(value));return value

    def assert_no_response_change(self):
        for name in ('metadata.json','data.json'):self.assertEqual((self.saved.directory/name).read_bytes(),self.before[name])

    def test_inventory_rejects_loss_for_all_manifest_time_fields_without_rewriting(self):
        for path in FIELDS:
            for fraction in ('0000001','0000000'):
                with self.subTest(path=path,fraction=fraction):
                    self.mutate(path,fraction);before=self.manifest_path.read_bytes()
                    with self.assertRaises(SSB14059RawStoreError):inspect_private_ssb_14059_pairs(root=self.root,now=self.now)
                    self.assertEqual(self.manifest_path.read_bytes(),before);self.assert_no_response_change()

    def test_bad_expiry_is_held_before_any_raw_body_open(self):
        self.mutate(('expires_at',));opened=[];original=Path.read_bytes
        def track(path,*args,**kwargs):
            if path.name in ('metadata.json','data.json'):opened.append(path.name)
            return original(path,*args,**kwargs)
        with patch('pathlib.Path.read_bytes',track),self.assertRaises(PrivateRawCustodyError):
            self.custody.read(self.saved.attempt_id,now=self.now)
        self.assertEqual(opened,[]);self.assert_no_response_change()

    def test_other_invalid_manifest_times_are_held_before_raw_body_open(self):
        for path in FIELDS[:-1]:
            self.mutate(path);opened=[];original=Path.read_bytes
            def track(file,*args,**kwargs):
                if file.name in ('metadata.json','data.json'):opened.append(file.name)
                return original(file,*args,**kwargs)
            with self.subTest(path=path),patch('pathlib.Path.read_bytes',track),self.assertRaises(PrivateRawCustodyError):
                self.custody.read(self.saved.attempt_id,now=self.now)
            self.assertEqual(opened,[]);self.assert_no_response_change()

    def test_invalid_manifest_cannot_authorize_prune_of_generated_fixture(self):
        for path in FIELDS:
            # A failing original prune can delete its own fixture. Each path
            # therefore has independent generated custody, rather than reusing it.
            case=RawManifestTimePrecisionTests();case.setUp()
            try:
                with self.subTest(path=path):
                    case.mutate(path);before={p.name:p.read_bytes() for p in case.saved.directory.iterdir()}
                    with self.assertRaises(SSB14059RawStoreError):
                        prune_expired_ssb_14059_pairs(root=case.root,now=case.now+RETENTION)
                    self.assertTrue(case.saved.directory.exists());self.assertEqual(before,{p.name:p.read_bytes() for p in case.saved.directory.iterdir()})
            finally:
                case.doCleanups()

    def test_writer_canonical_values_and_supported_equivalents_preserve_custody(self):
        for fraction in ('0','00','000000'):
            value=json.loads(self.original)
            for path in FIELDS:
                stamp=field(value,path)
                stamp=stamp[:-1]+'.'+fraction+'Z' if stamp.endswith('Z') else stamp.replace('+00:00','.'+fraction+'Z')
                change(value,path,stamp)
            self.manifest_path.write_text(json.dumps(value))
            entries=inspect_private_ssb_14059_pairs(root=self.root,now=self.now)
            self.assertEqual(len(entries),1);self.assertEqual(entries[0].expires_at,self.saved.expires_at)
            retained=self.custody.read(self.saved.attempt_id,now=self.now)
            self.assertEqual(retained.metadata_response.body,self.before['metadata.json'])
            self.assertEqual(retained.data_response.body,self.before['data.json']);self.assert_no_response_change()

    def test_unsupported_calendar_and_non_utc_forms_still_hold_without_raw_access(self):
        for stamp in ('2026-11-01 10:00:00Z','2026-W44-7T10:00:00Z','2026-11-01T10:00:00,0Z','2026-11-01T10:00:00+01:00'):
            value=json.loads(self.original);value['expires_at']=stamp;self.manifest_path.write_text(json.dumps(value))
            with self.subTest(stamp=stamp),self.assertRaises(PrivateRawCustodyError):self.custody.read(self.saved.attempt_id,now=self.now)
            self.assert_no_response_change()
