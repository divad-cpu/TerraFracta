"""Health chronology, actual file refusal and held/no-permission observations."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import os
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from workers.private_attempt_readiness import cleanup_health, check_units, readiness_record
from scripts.check_private_attempt_readiness import (private_read, health_observation,
    raw_observation, main, UNIT_HASHES, unit_status)
from scripts.ssb_raw_retention_service import run_retention_once


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 2, 6, 30, tzinfo=timezone.utc)
        self.base = {'schemaVersion': 1, 'evidenceKind': 'private_raw_cleanup_run',
            'runId': '20261002T063000000000Z-'+'a'*32, 'startedAt': self.now.isoformat(),
            'sourceRequests': 0, 'databaseChanged': False, 'physicalDeadlineGuaranteed': False}
        self.start = {**self.base, 'state': 'running'}
        self.finish = {**self.base, 'state': 'completed', 'finishedAt': self.now.isoformat(),
            'elapsedSeconds': 0.01, 'expiredAttemptsObserved': 0, 'attemptsRemoved': 0,
            'activeAttemptsRemaining': 0}

    def assess(self, *, start=None, finish=None, latest=None, seconds=1):
        return cleanup_health(self.finish if latest is None else latest,
            self.start if start is None else start, self.finish if finish is None else finish,
            observed_at=(self.now+timedelta(seconds=seconds)).isoformat())

    def test_recent_matching_records_and_exact_age_boundary(self):
        self.assertEqual(self.assess()['state'], 'observed')
        self.assertEqual(self.assess(seconds=1200)['state'], 'observed')
        self.assertEqual(self.assess(seconds=1200.000001)['state'], 'held')
        self.assertEqual(self.assess(seconds=-0.000001)['state'], 'held')

    def test_blocked_running_missing_and_divergent_records_are_held(self):
        for value in (None, {}, self.start, {**self.finish, 'state': 'blocked'},
                      {**self.finish, 'runId': 'b'*32}, {**self.finish, 'extra': 'canary'}):
            with self.subTest(value=value):
                result=cleanup_health(value,self.start,self.finish,observed_at=self.now.isoformat())
                self.assertEqual(result['state'], 'held');self.assertNotIn('canary',json.dumps(result))
        self.assertEqual(self.assess(start={**self.start,'sourceRequests':1})['state'],'held')

    def test_scalar_coercion_invalid_counts_and_timezone_are_held(self):
        for key,value in (('schemaVersion',True),('sourceRequests',False),
            ('attemptsRemoved',False),('activeAttemptsRemaining',0.0),('elapsedSeconds',True),
            ('elapsedSeconds',float('nan')),('elapsedSeconds',30),('attemptsRemoved',1),
            ('expiredAttemptsObserved',-1),('finishedAt','2026-10-02T06:30:00'),
            ('finishedAt','2026-10-02T06:30:00+01:00')):
            changed={**self.finish,key:value}
            with self.subTest(key=key,value=value):
                self.assertEqual(self.assess(finish=changed,latest=changed)['state'],'held')

    def test_latest_scalar_coercion_does_not_hide_behind_python_equality(self):
        for key,value in (('attemptsRemoved',False),('activeAttemptsRemaining',False),
                          ('elapsedSeconds',True),('expiredAttemptsObserved',0.0)):
            with self.subTest(key=key):
                self.assertEqual(self.assess(latest={**self.finish,key:value})['state'],'held')

    def test_run_timestamp_and_clock_reversal_cannot_support_recent_health(self):
        wrong={**self.finish,'runId':'20261001T063000000000Z-'+'a'*32}
        start={**self.start,'runId':wrong['runId']}
        self.assertEqual(self.assess(start=start,finish=wrong,latest=wrong)['state'],'held')
        wrong={**self.finish,'startedAt':(self.now+timedelta(seconds=1)).isoformat()}
        start={**self.start,'startedAt':wrong['startedAt']}
        self.assertEqual(self.assess(start=start,finish=wrong,latest=wrong)['state'],'held')

    def test_exact_units_hold_overrides_reload_failed_service_and_inactive_timer(self):
        common={'LoadState':'loaded','DropInPaths':'','NeedDaemonReload':'no','Transient':'no'}
        service={**common,'ActiveState':'inactive','Result':'success','ExecMainStatus':'0',
            'UnitFileState':'static','FragmentPath':'/etc/systemd/system/terrafracta-ssb-raw-retention.service'}
        timer={**common,'ActiveState':'active','UnitFileState':'enabled',
            'FragmentPath':'/etc/systemd/system/terrafracta-ssb-raw-retention.timer',
            'Triggers':'terrafracta-ssb-raw-retention.service'}
        self.assertEqual(check_units(service,timer)['state'],'observed')
        for which,key,value in (('service','DropInPaths','/private-canary'),
            ('timer','NeedDaemonReload','yes'),('service','Result','failed'),
            ('service','ActiveState','activating'),('timer','ActiveState','inactive'),
            ('timer','Triggers','other.service'),('timer','Transient','yes')):
            s,t=deepcopy(service),deepcopy(timer);(s if which=='service' else t)[key]=value
            with self.subTest(key=key):
                got=check_units(s,t);self.assertEqual(got['state'],'held');self.assertNotIn('canary',json.dumps(got))

    def test_fixed_unit_selector_and_main_refuse_before_any_operation(self):
        with self.assertRaises(ValueError),patch('subprocess.run') as run:
            unit_status('other.service')
        run.assert_not_called()
        with patch('scripts.check_private_attempt_readiness.sys.argv',['readiness','--fetch']), \
                patch('scripts.check_private_attempt_readiness.observe') as observe,patch('builtins.print'):
            self.assertEqual(main(),2);observe.assert_not_called()

    def test_observation_cannot_issue_permission_even_with_healthy_inputs(self):
        good={'state':'observed','reason':'fixture'}
        result=readiness_record(observed_at=self.now.isoformat(),snapshot_verified=True,
            unit_bytes_verified=True,manager=good,health=good,raw_folder=good,
            copy_policy={'timeshiftExclusionObserved':True,'rcloneConfigurationPresent':True,
                         'allCopyPathsVerified':True,'ownerApproval':'canary'})
        self.assertEqual(result['state'],'held');self.assertIs(result['machinePermissionIssued'],False)
        self.assertEqual(result['sourceRequests'],0);self.assertIs(result['publicationEnabled'],False)
        self.assertIs(result['checks']['configuredCopies']['allCopyPathsVerified'],False)
        self.assertNotIn('canary',json.dumps(result))


class ReadinessFileTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.now=datetime.now(timezone.utc)

    def test_real_cleanup_records_are_read_without_rewriting_them(self):
        raw=self.root/'raw';health=self.root/'health'
        result=run_retention_once(raw_root=raw,health_root=health)
        self.assertEqual(result['state'],'completed')
        before={str(p.relative_to(health)):p.read_bytes() for p in health.rglob('*.json')}
        got=health_observation(root=health,observed_at=datetime.now(timezone.utc).isoformat())
        self.assertEqual(got['state'],'observed')
        self.assertEqual(before,{str(p.relative_to(health)):p.read_bytes() for p in health.rglob('*.json')})

    def test_fresh_private_file_is_read_bounded_without_atime_false_failure(self):
        path=self.root/'evidence.json';path.write_bytes(b'{"state":"fixture"}');path.chmod(0o600)
        self.assertEqual(private_read(path),path.read_bytes())

    def test_symlink_hardlink_fifo_shared_mode_and_oversize_are_refused(self):
        path=self.root/'record';path.write_bytes(b'canary');path.chmod(0o600)
        link=self.root/'link';link.symlink_to(path)
        with self.assertRaises((ValueError,OSError)):private_read(link)
        link.unlink();os.link(path,link)
        with self.assertRaises(ValueError):private_read(path)
        link.unlink();path.chmod(0o644)
        with self.assertRaises(ValueError):private_read(path)
        path.chmod(0o600)
        with self.assertRaises(ValueError):private_read(path,limit=2)
        fifo=self.root/'fifo';os.mkfifo(fifo,0o600)
        with self.assertRaises(ValueError):private_read(fifo)

    def test_missing_finish_duplicate_fields_and_shared_history_are_held(self):
        raw=self.root/'raw';health=self.root/'health';result=run_retention_once(raw_root=raw,health_root=health)
        finish=health/'runs'/(result['runId']+'-finish.json');original=finish.read_bytes();finish.unlink()
        self.assertEqual(health_observation(root=health,observed_at=datetime.now(timezone.utc).isoformat())['state'],'held')
        finish.write_bytes(original);finish.chmod(0o600)
        latest=health/'latest.json';latest.write_bytes(b'{"runId":"a","runId":"b"}');latest.chmod(0o600)
        self.assertEqual(health_observation(root=health,observed_at=datetime.now(timezone.utc).isoformat())['state'],'held')
        latest.write_bytes(original);(health/'runs').chmod(0o755)
        self.assertEqual(health_observation(root=health,observed_at=datetime.now(timezone.utc).isoformat())['state'],'held')

    def test_raw_check_reads_no_body_and_preserves_unexpected_item(self):
        raw=self.root/'raw';raw.mkdir(mode=0o700)
        self.assertEqual(raw_observation(raw)['state'],'observed')
        path=raw/'private-canary.json';path.write_bytes(b'do not open')
        with patch.object(Path,'read_bytes',side_effect=AssertionError('raw opened')):
            got=raw_observation(raw)
        self.assertEqual(got['state'],'held');self.assertNotIn('canary',json.dumps(got))
        self.assertEqual(path.read_bytes(),b'do not open')


if __name__=='__main__':unittest.main()
