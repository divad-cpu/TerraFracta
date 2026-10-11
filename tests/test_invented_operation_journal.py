"""Real filesystem/process tests of a retained one-shot invented operation."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import multiprocessing
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch

from scripts.fictional_trial_guard import trial_process_lock
from workers.invented_operation_journal import (
    EXPECTED,FINISH,HELD,START,checked_execution,inspect_invented_operation,run_invented_operation,
)


def result_at(now):return {**deepcopy(EXPECTED),'recordedAt':now.isoformat()}


def wait_in_owned_child(directory,ready,release):
    def run():
        ready.set()
        if not release.wait(10):raise RuntimeError('Owned test timed out')
        return result_at(datetime.now(timezone.utc))
    run_invented_operation(Path(directory),run)


class InventedOperationJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.root=self.base/'operation'
        self.now=datetime(2026,10,2,13,tzinfo=timezone.utc);self.calls=0

    def runner(self):
        self.calls+=1
        self.assertTrue((self.root/START).is_file())
        return result_at(self.now)

    def start(self,run=None):return run_invented_operation(self.root,run or self.runner,utc_now=lambda:self.now)

    def inspect(self):return inspect_invented_operation(self.root,now=self.now)

    def rewrite(self,name,change):
        path=self.root/name;value=json.loads(path.read_bytes());change(value)
        path.write_text(json.dumps(value))

    def test_absent_read_is_idle_without_creating_anything(self):
        before=list(self.base.iterdir())
        self.assertEqual(self.inspect(),{'state':'idle'});self.assertEqual(list(self.base.iterdir()),before)

    def test_start_is_synced_before_runner_and_finish_is_reopened(self):
        synced=[];original=os.fsync
        def sync(fd):synced.append(fd);original(fd)
        def run():
            self.assertEqual(len(synced),2);return self.runner()
        with patch('workers.invented_operation_journal.os.fsync',side_effect=sync):value=self.start(run)
        self.assertEqual(value,{'state':'checked','result':result_at(self.now)})
        self.assertEqual(len(synced),4);self.assertEqual(self.calls,1)
        self.assertEqual(self.root.stat().st_mode&0o777,0o700)
        for name in ('process.lock',START,FINISH):self.assertEqual((self.root/name).stat().st_mode&0o777,0o600)

    def test_new_controller_and_repeated_start_keep_same_bytes_and_one_call(self):
        first=self.start();before={p.name:p.read_bytes() for p in self.root.iterdir()}
        self.now+=timedelta(minutes=1)
        self.assertEqual(self.inspect(),first);self.assertEqual(self.start(),first)
        self.assertEqual(self.calls,1);self.assertEqual({p.name:p.read_bytes() for p in self.root.iterdir()},before)

    def test_failure_and_keyboard_interrupt_are_retained_without_diagnostic_or_retry(self):
        for fault in (RuntimeError('private-canary'),KeyboardInterrupt('private-canary')):
            root=self.base/type(fault).__name__;calls=[]
            def run():calls.append(1);raise fault
            self.assertEqual(run_invented_operation(root,run,utc_now=lambda:self.now),HELD)
            self.assertEqual(run_invented_operation(root,run,utc_now=lambda:self.now),HELD)
            self.assertEqual(calls,[1]);self.assertNotIn(b'private-canary',(root/FINISH).read_bytes())

    def test_existing_partial_start_is_consumed_and_never_repaired(self):
        self.root.mkdir(mode=0o700)
        with trial_process_lock(self.root):
            path=self.root/START;path.write_bytes(b'{');path.chmod(0o600)
        before=(self.root/START).read_bytes()
        self.assertEqual(self.inspect(),HELD);self.assertEqual(self.start(),HELD)
        self.assertEqual(self.calls,0);self.assertEqual((self.root/START).read_bytes(),before)
        self.assertFalse((self.root/FINISH).exists())

    def test_start_fsync_failure_never_invokes_runner_and_keeps_evidence(self):
        with patch('workers.invented_operation_journal.os.fsync',side_effect=OSError('private-canary')):
            self.assertEqual(self.start(),HELD)
        self.assertTrue((self.root/START).exists());self.assertEqual(self.start(),HELD);self.assertEqual(self.calls,0)

    def test_finish_failure_does_not_replay_a_completed_runner(self):
        original=os.fsync;calls=[]
        def sync(fd):
            calls.append(1)
            if len(calls)==3:raise OSError('private-canary')
            original(fd)
        with patch('workers.invented_operation_journal.os.fsync',side_effect=sync):self.assertEqual(self.start(),HELD)
        # Readback is historical evidence, not a claim that the failed fsync was
        # acknowledged. It must never cause a second native trial.
        self.start();self.assertEqual(self.calls,1)

    def test_finish_is_bound_to_exact_start_bytes(self):
        self.start();self.rewrite(START,lambda value:value.update(operationId='f'*32))
        self.assertEqual(self.inspect(),HELD);self.assertEqual(self.start(),HELD);self.assertEqual(self.calls,1)

    def test_replaced_missing_or_extra_evidence_stays_held(self):
        self.start()
        self.rewrite(FINISH,lambda value:value.update(privateCanary='must-not-export'))
        self.assertEqual(self.inspect(),HELD)
        unexpected=self.root/'unexpected';unexpected.write_bytes(b'private-canary')
        self.assertEqual(self.start(),HELD);self.assertEqual(self.calls,1)

    def test_duplicate_json_keys_and_non_object_records_refuse(self):
        self.start();original=(self.root/FINISH).read_bytes()
        for raw in (b'[]',b'null',b'{"schemaVersion":1,"schemaVersion":1}',b'\xff'):
            (self.root/FINISH).write_bytes(raw)
            self.assertEqual(self.inspect(),HELD)
        (self.root/FINISH).write_bytes(original)
        self.assertEqual(self.inspect()['state'],'checked')

    def test_record_time_cannot_precede_start_or_be_in_future(self):
        self.assertEqual(self.start(lambda:result_at(self.now-timedelta(seconds=1))),HELD)
        self.assertEqual(self.calls,0)
        self.rewrite(START,lambda value:value.update(startedAt=(self.now+timedelta(seconds=1)).isoformat()))
        self.assertEqual(self.inspect(),HELD)

    def test_finish_timeline_is_strict_after_restart(self):
        self.start();self.rewrite(FINISH,lambda value:value.update(finishedAt=(self.now-timedelta(seconds=1)).isoformat()))
        self.assertEqual(self.inspect(),HELD)

    def test_exact_summary_rejects_boolean_numbers_private_fields_and_live_claims(self):
        good=result_at(self.now);self.assertEqual(checked_execution(good),good)
        for key,value in (('schemaVersion',True),('savedPairs',True),('selectedYears',[True,2025]),
                ('sourceRequests',False),('publicationEnabled',True),('sourcePermissionIssued',True),
                ('originalHttpModuleExecuted',True),('recordedAt','2026-10-02 13:00:00+00:00'),
                ('privateEvidenceDirectory','private-canary')):
            with self.subTest(key=key),self.assertRaises(ValueError):checked_execution({**good,key:value})

    def test_symlink_hardlink_modes_and_oversized_records_are_not_read(self):
        self.start();path=self.root/FINISH;original=path.read_bytes()
        path.chmod(0o644);self.assertEqual(self.inspect(),HELD);path.chmod(0o600)
        link=self.base/'hardlink';os.link(path,link);self.assertEqual(self.inspect(),HELD);link.unlink()
        path.write_bytes(b' '*8193);self.assertEqual(self.inspect(),HELD);path.write_bytes(original)
        target=self.base/'outside';target.write_bytes(original);target.chmod(0o600)
        path.unlink();path.symlink_to(target);self.assertEqual(self.inspect(),HELD)
        self.assertEqual(self.start(),HELD);self.assertEqual(self.calls,1)

    def test_parent_and_root_symlinks_do_not_select_another_target(self):
        real=self.base/'real';real.mkdir(mode=0o700);self.root.symlink_to(real,target_is_directory=True)
        self.assertEqual(self.inspect(),HELD);self.assertEqual(self.start(),HELD)
        self.assertEqual(list(real.iterdir()),[]);self.assertEqual(self.calls,0)

    def test_read_only_inspection_does_not_create_a_missing_lock(self):
        self.root.mkdir(mode=0o700)
        self.assertEqual(self.inspect(),HELD);self.assertEqual(list(self.root.iterdir()),[])
        self.assertEqual(self.start(),HELD);self.assertEqual(list(self.root.iterdir()),[]);self.assertEqual(self.calls,0)

    def test_busy_valid_start_is_running_and_second_process_never_calls_runner(self):
        context=multiprocessing.get_context('spawn');ready=context.Event();release=context.Event()
        child=context.Process(target=wait_in_owned_child,args=(str(self.root),ready,release));child.start()
        try:
            self.assertTrue(ready.wait(5))
            now=datetime.now(timezone.utc)
            self.assertEqual(inspect_invented_operation(self.root,now=now),{'state':'running'})
            self.assertEqual(run_invented_operation(self.root,self.runner),{'state':'running'});self.assertEqual(self.calls,0)
            release.set();child.join(5);self.assertEqual(child.exitcode,0)
            self.assertEqual(inspect_invented_operation(self.root)['state'],'checked')
        finally:
            release.set()
            if child.is_alive():child.kill();child.join(5)

    def test_actual_owned_process_kill_leaves_consumed_start_and_no_retry(self):
        context=multiprocessing.get_context('spawn');ready=context.Event();release=context.Event()
        child=context.Process(target=wait_in_owned_child,args=(str(self.root),ready,release));child.start()
        try:
            self.assertTrue(ready.wait(5));before=(self.root/START).read_bytes()
            os.kill(child.pid,signal.SIGKILL);child.join(5);self.assertEqual(child.exitcode,-signal.SIGKILL)
            self.assertEqual(inspect_invented_operation(self.root),HELD)
            self.assertEqual(run_invented_operation(self.root,self.runner),HELD);self.assertEqual(self.calls,0)
            self.assertEqual((self.root/START).read_bytes(),before);self.assertFalse((self.root/FINISH).exists())
        finally:
            if child.is_alive():child.kill();child.join(5)


if __name__=='__main__':unittest.main()
