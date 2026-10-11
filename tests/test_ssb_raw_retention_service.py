"""Synthetic operational cleanup, exact access expiry and retained incidents."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.ssb_raw_retention_service import run_retention_once
from workers.ssb_14059_capture import CapturedResponse, METADATA_URL, DATA_URL
from workers.ssb_14059_raw_custody import PrivateRawCustody, PrivateRawCustodyError
from workers.ssb_14059_raw_store import RETENTION

FIXTURES=Path(__file__).resolve().parents[1]/'fixtures'

class RetentionServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.parent=Path(self.temp.name);self.raw=self.parent/'raw';self.health=self.parent/'health'
        self.now=datetime(2026,10,1,12,tzinfo=timezone.utc)

    def responses(self,retrieved):
        return tuple(CapturedResponse(url,url,0,200,'application/json',(FIXTURES/name).read_bytes(),retrieved)
            for url,name in ((METADATA_URL,'ssb_14059_metadata_minimal_2024_2025.json'),(DATA_URL,'ssb_14059_jsonstat_minimal_2024_2025.json')))

    def save(self,retrieved):
        with PrivateRawCustody(self.raw) as custody: return custody.store(*self.responses(retrieved),now=retrieved)

    def test_startup_removes_expired_only_and_preserves_exact_active_bytes(self):
        expired=self.save(self.now-RETENTION);active=self.save(self.now)
        before={p.name:p.read_bytes() for p in active.directory.iterdir()}
        result=run_retention_once(raw_root=self.raw,health_root=self.health,now=self.now)
        self.assertEqual(result['state'],'completed');self.assertEqual(result['attemptsRemoved'],1)
        self.assertEqual(result['activeAttemptsRemaining'],1);self.assertFalse(expired.directory.exists())
        self.assertEqual({p.name:p.read_bytes() for p in active.directory.iterdir()},before)
        self.assertEqual(json.loads((self.health/'latest.json').read_bytes()),result)
        files=list((self.health/'runs').iterdir());self.assertEqual(len(files),2)
        self.assertTrue(all(p.stat().st_mode&0o777==0o600 for p in files))
        self.assertNotIn(expired.attempt_id,json.dumps(result));self.assertFalse(result['physicalDeadlineGuaranteed'])

    def test_unexpected_item_blocks_deletion_and_preserves_incident_history(self):
        expired=self.save(self.now-RETENTION);unknown=self.raw/'unknown';unknown.write_bytes(b'private canary')
        result=run_retention_once(raw_root=self.raw,health_root=self.health,now=self.now)
        self.assertEqual(result['state'],'blocked');self.assertTrue(expired.directory.exists())
        self.assertEqual(unknown.read_bytes(),b'private canary');self.assertNotIn('canary',json.dumps(result))
        starts=[p.read_bytes() for p in (self.health/'runs').iterdir()]
        later=run_retention_once(raw_root=self.raw,health_root=self.health,now=self.now+timedelta(seconds=1))
        self.assertEqual(later['state'],'blocked');self.assertEqual(len(list((self.health/'runs').iterdir())),4)
        self.assertTrue(all(record in [p.read_bytes() for p in (self.health/'runs').iterdir()] for record in starts))

    def test_live_lock_contention_is_reported_without_deleting_or_waiting(self):
        expired=self.save(self.now-RETENTION)
        with PrivateRawCustody(self.raw):
            result=run_retention_once(raw_root=self.raw,health_root=self.health,now=self.now)
        self.assertEqual(result['state'],'blocked');self.assertTrue(expired.directory.exists())
        self.assertLess(result['elapsedSeconds'],1)

    def test_crash_after_first_owned_delete_retains_start_then_next_run_recovers(self):
        saved=self.save(self.now-RETENTION)
        code='''from pathlib import Path
from datetime import datetime
import os,sys
from scripts.ssb_raw_retention_service import run_retention_once
original=Path.unlink
def crash(path,*args,**kwargs):
 original(path,*args,**kwargs)
 if path.name=='data.json': os._exit(17)
Path.unlink=crash
run_retention_once(raw_root=Path(sys.argv[1]),health_root=Path(sys.argv[2]),now=datetime.fromisoformat(sys.argv[3]))
'''
        child=subprocess.run([sys.executable,'-c',code,str(self.raw),str(self.health),self.now.isoformat()],capture_output=True,timeout=2)
        self.assertEqual(child.returncode,17);self.assertEqual(child.stdout,b'');self.assertEqual(child.stderr,b'')
        self.assertFalse((saved.directory/'data.json').exists());self.assertTrue((saved.directory/'manifest.json').exists())
        interrupted=json.loads((self.health/'latest.json').read_bytes());self.assertEqual(interrupted['state'],'running')
        start=(self.health/'runs'/(interrupted['runId']+'-start.json'));before=start.read_bytes()
        result=run_retention_once(raw_root=self.raw,health_root=self.health,now=self.now+timedelta(seconds=1))
        self.assertEqual(result['state'],'completed');self.assertEqual(result['attemptsRemoved'],1)
        self.assertFalse(saved.directory.exists());self.assertEqual(start.read_bytes(),before)
        self.assertFalse((self.health/'runs'/(interrupted['runId']+'-finish.json')).exists())

    def test_no_health_alias_symlink_shared_mode_or_raw_overlap_is_accepted(self):
        for bad in (self.raw,self.raw/'nested',self.parent):
            with self.subTest(root=str(bad)),self.assertRaises(ValueError): run_retention_once(raw_root=self.raw,health_root=bad,now=self.now)
        self.health.symlink_to(self.parent/'absent')
        with self.assertRaises(ValueError): run_retention_once(raw_root=self.raw,health_root=self.health,now=self.now)
        self.health.unlink();self.health.mkdir(mode=0o755);self.health.chmod(0o755)
        with self.assertRaises(ValueError): run_retention_once(raw_root=self.raw,health_root=self.health,now=self.now)

    def test_production_entry_refuses_arguments_before_any_storage_operation(self):
        from scripts.ssb_raw_retention_service import main
        with patch('scripts.ssb_raw_retention_service.sys.argv',['service','--root','other']),patch('scripts.ssb_raw_retention_service.run_retention_once') as cleanup,patch('builtins.print'):
            self.assertEqual(main(),2);cleanup.assert_not_called()

if __name__=='__main__': unittest.main()
